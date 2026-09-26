<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Exceptions\SafeguardingPolicyException;
use App\Services\GroupInviteService;
use Illuminate\Http\JsonResponse;

/** Invite links, email invitations, previews, acceptance, and revocation. */
final class GroupInviteController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(
        private readonly GroupInviteService $inviteService,
    ) {}

    public function index(int $id): JsonResponse
    {
        $result = $this->inviteService->getPendingInvites($id, $this->requireUserId());

        return $result === null
            ? $this->inviteErrorResponse(__('errors.group_invites.listing_failed'))
            : $this->respondWithData($result);
    }

    public function createLink(int $id): JsonResponse
    {
        $rawExpiryDays = request()->input('expiry_days');
        $expiryDays = null;
        if ($rawExpiryDays !== null) {
            $validated = filter_var($rawExpiryDays, FILTER_VALIDATE_INT);
            if ($validated === false) {
                return $this->respondWithError(
                    'VALIDATION_ERROR',
                    __('api.value_out_of_range', ['min' => 1, 'max' => 90]),
                    'expiry_days',
                    422,
                );
            }
            $expiryDays = (int) $validated;
        }

        $result = $this->inviteService->createLink($id, $this->requireUserId(), $expiryDays);

        return $result === null
            ? $this->inviteErrorResponse(__('errors.group_invites.create_failed'))
            : $this->respondWithData($result, null, 201);
    }

    public function sendEmails(int $id): JsonResponse
    {
        $userId = $this->requireUserId();
        $this->rateLimit('group_invite_email', 10, 3600);

        $emails = request()->input('emails');
        if (! is_array($emails) || $emails === []) {
            return $this->respondWithError(
                'VALIDATION_ERROR',
                __('api.group_invites_emails_required'),
                'emails',
                422,
            );
        }
        if (count($emails) > GroupInviteService::MAX_PENDING_INVITES) {
            return $this->respondWithError(
                'VALIDATION_ERROR',
                __('api.group_invites_max_per_request'),
                'emails',
                422,
            );
        }

        // Laravel converts an empty JSON string to null before the controller runs.
        // The invitation message is optional, so a blank field must stay equivalent to omission.
        $message = request()->input('message');
        if ($message === null) {
            $message = '';
        }
        if (! is_string($message)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_input'), 'message', 422);
        }

        try {
            $result = $this->inviteService->sendEmailInvites($id, $userId, $emails, $message);
        } catch (SafeguardingPolicyException $e) {
            return $this->safeguardingPolicyError($e);
        }

        return $result === null
            ? $this->inviteErrorResponse(__('errors.group_invites.send_failed'))
            : $this->respondWithData($result);
    }

    public function revoke(int $id, int $inviteId): JsonResponse
    {
        if (! $this->inviteService->revokeInvite($id, $inviteId, $this->requireUserId())) {
            return $this->inviteErrorResponse(__('errors.group_invites.revoke_failed'));
        }

        return $this->respondWithData([
            'id' => $inviteId,
            'status' => GroupInviteService::STATUS_REVOKED,
        ]);
    }

    /** GET /api/v2/groups/invite/{token} */
    public function show(string $token): JsonResponse
    {
        $result = $this->inviteService->previewInvite($token, $this->requireUserId());

        return $result === null
            ? $this->inviteErrorResponse(__('errors.group_invites.listing_failed'))
            : $this->respondWithData($result);
    }

    /** POST /api/v2/groups/invite/{token}/accept */
    public function accept(string $token): JsonResponse
    {
        try {
            $result = $this->inviteService->acceptInvite($token, $this->requireUserId());
        } catch (SafeguardingPolicyException $e) {
            return $this->safeguardingPolicyError($e);
        }

        return $result === null
            ? $this->inviteErrorResponse(__('errors.group_invites.accept_failed'))
            : $this->respondWithData($result);
    }

    private function inviteErrorResponse(string $fallback): JsonResponse
    {
        $error = $this->inviteService->getErrors()[0] ?? [
            'code' => 'INVITE_FAILED',
            'message' => $fallback,
        ];
        $code = (string) ($error['code'] ?? 'INVITE_FAILED');

        return $this->respondWithError(
            $code,
            (string) ($error['message'] ?? $fallback),
            isset($error['field']) ? (string) $error['field'] : null,
            match ($code) {
                'NOT_FOUND' => 404,
                'FORBIDDEN', 'BANNED', 'EMAIL_MISMATCH' => 403,
                'EXPIRED', 'REVOKED' => 410,
                'CAPACITY_FULL', 'MEMBERSHIP_LIMIT_REACHED', 'GROUP_UNAVAILABLE', 'INVITE_LIMIT_REACHED' => 409,
                'VALIDATION_ERROR' => 422,
                default => 400,
            },
        );
    }
}
