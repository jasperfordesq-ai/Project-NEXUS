<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use App\Core\EmailTemplateBuilder;
use App\Core\TenantContext;
use App\Enums\GroupStatus;
use App\Events\GroupMemberJoined;
use App\I18n\LocaleContext;
use App\Models\Group;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use RuntimeException;
use App\Support\UserDisplayName;

/** Manages tenant-scoped group invitations, previews, acceptance, and revocation. */
final class GroupInviteService
{
    public const STATUS_PENDING = 'pending';
    public const STATUS_ACCEPTED = 'accepted';
    public const STATUS_EXPIRED = 'expired';
    public const STATUS_REVOKED = 'revoked';

    public const INVITE_EXPIRY_DAYS = 14;
    public const MAX_PENDING_INVITES = 50;

    /** @var list<array{code: string, message: string, field?: string}> */
    private array $errors = [];

    /** @return list<array{code: string, message: string, field?: string}> */
    public function getErrors(): array
    {
        return $this->errors;
    }

    /** Generate a reusable share link. */
    public function createLink(int $groupId, int $inviterId, ?int $expiryDays = null): ?array
    {
        $this->errors = [];
        $tenantId = (int) TenantContext::getId();
        $expiryDays ??= self::INVITE_EXPIRY_DAYS;

        if ($expiryDays < 1 || $expiryDays > 90) {
            $this->errors[] = [
                'code' => 'VALIDATION_ERROR',
                'message' => __('api.value_out_of_range', ['min' => 1, 'max' => 90]),
                'field' => 'expiry_days',
            ];
            return null;
        }
        if (! $this->canInvite($groupId, $inviterId)) {
            $this->errors[] = ['code' => 'FORBIDDEN', 'message' => __('api.group_invite_forbidden')];
            return null;
        }

        return DB::transaction(function () use ($groupId, $inviterId, $expiryDays, $tenantId): ?array {
            $group = $this->lockActiveInviteGroup($groupId, $tenantId);
            if ($group === null) {
                return null;
            }

            $this->expirePendingInvitesForGroup($groupId, $tenantId);
            if ($this->pendingInviteCount($groupId, $tenantId) >= self::MAX_PENDING_INVITES) {
                $this->errors[] = [
                    'code' => 'INVITE_LIMIT_REACHED',
                    'message' => __('api.group_invite_pending_limit_reached'),
                ];
                return null;
            }

            $expiresAt = now()->addDays($expiryDays);
            [$inviteId, $token] = $this->insertInvite([
                'tenant_id' => $tenantId,
                'group_id' => $groupId,
                'invited_by' => $inviterId,
                'invite_type' => 'link',
                'status' => self::STATUS_PENDING,
                'expires_at' => $expiresAt,
                'created_at' => now(),
                'updated_at' => now(),
            ]);

            return [
                'id' => $inviteId,
                'type' => 'link',
                'invite_type' => 'link',
                'status' => self::STATUS_PENDING,
                'invite_url' => $this->buildInviteUrl($token),
                'expires_at' => $expiresAt->toIso8601String(),
                'created_at' => now()->toIso8601String(),
            ];
        }, 3);
    }

    /**
     * Send email invitations after committing their durable invite rows.
     *
     * @param list<mixed> $emails
     * @return list<array<string, mixed>>|null
     */
    public function sendEmailInvites(int $groupId, int $inviterId, array $emails, string $message = ''): ?array
    {
        $this->errors = [];
        $tenantId = (int) TenantContext::getId();
        $message = trim($message);

        if (mb_strlen($message) > 10000) {
            $this->errors[] = [
                'code' => 'VALIDATION_ERROR',
                'message' => __('api.message_too_long'),
                'field' => 'message',
            ];
            return null;
        }
        if (! $this->canInvite($groupId, $inviterId)) {
            $this->errors[] = ['code' => 'FORBIDDEN', 'message' => __('api.group_invite_forbidden')];
            return null;
        }

        $invalidResults = [];
        $validEmails = [];
        $seen = [];
        foreach ($emails as $rawEmail) {
            $email = strtolower(trim((string) $rawEmail));
            if (filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
                $invalidResults[] = [
                    'email' => $email,
                    'status' => 'invalid',
                    'message' => __('api.group_invite_invalid_email'),
                ];
                continue;
            }
            if (isset($seen[$email])) {
                continue;
            }
            $seen[$email] = true;
            $validEmails[] = $email;
        }

        /** @var array<string, User> $recipientUsers */
        $recipientUsers = User::query()
            ->where('tenant_id', $tenantId)
            ->whereIn('email', $validEmails)
            ->get()
            ->keyBy(static fn (User $user): string => strtolower((string) $user->email))
            ->all();

        foreach ($recipientUsers as $recipient) {
            if ((int) $recipient->id === $inviterId) {
                continue;
            }
            app(SafeguardingInteractionPolicy::class)->assertLocalContactAllowed(
                $inviterId,
                (int) $recipient->id,
                $tenantId,
                'group_email_invitation',
            );
        }

        $committed = DB::transaction(function () use (
            $groupId,
            $inviterId,
            $validEmails,
            $recipientUsers,
            $message,
            $tenantId,
        ): ?array {
            $group = $this->lockActiveInviteGroup($groupId, $tenantId);
            if ($group === null) {
                return null;
            }

            $this->expirePendingInvitesForGroup($groupId, $tenantId);
            $pendingCount = $this->pendingInviteCount($groupId, $tenantId);
            $results = [];
            $mailJobs = [];

            foreach ($validEmails as $email) {
                $recipient = $recipientUsers[$email] ?? null;
                if ($recipient !== null && DB::table('group_members')
                    ->where('tenant_id', $tenantId)
                    ->where('group_id', $groupId)
                    ->where('user_id', (int) $recipient->id)
                    ->where('status', 'active')
                    ->exists()) {
                    $results[] = ['email' => $email, 'status' => 'already_member'];
                    continue;
                }

                $existingInvite = DB::table('group_invites')
                    ->where('tenant_id', $tenantId)
                    ->where('group_id', $groupId)
                    ->where('email', $email)
                    ->where('status', self::STATUS_PENDING)
                    ->where('expires_at', '>', now())
                    ->first();
                if ($existingInvite !== null) {
                    $results[] = ['email' => $email, 'status' => 'already_invited'];
                    continue;
                }

                if ($pendingCount >= self::MAX_PENDING_INVITES) {
                    $results[] = ['email' => $email, 'status' => 'limit_reached'];
                    continue;
                }

                $expiresAt = now()->addDays(self::INVITE_EXPIRY_DAYS);
                [$inviteId, $token] = $this->insertInvite([
                    'tenant_id' => $tenantId,
                    'group_id' => $groupId,
                    'invited_by' => $inviterId,
                    'invite_type' => 'email',
                    'email' => $email,
                    'message' => $message !== '' ? $message : null,
                    'status' => self::STATUS_PENDING,
                    'expires_at' => $expiresAt,
                    'created_at' => now(),
                    'updated_at' => now(),
                ]);
                ++$pendingCount;

                $results[] = [
                    'email' => $email,
                    'status' => 'sent',
                    'email_delivered' => null,
                    'invite' => [
                        'id' => $inviteId,
                        'type' => 'email',
                        'status' => self::STATUS_PENDING,
                        'expires_at' => $expiresAt->toIso8601String(),
                    ],
                ];
                $mailJobs[$inviteId] = [
                    'email' => $email,
                    'token' => $token,
                    'recipient' => $recipient,
                ];
            }

            return ['group' => $group, 'results' => $results, 'mail_jobs' => $mailJobs];
        }, 3);

        if ($committed === null) {
            return null;
        }

        $inviter = User::query()
            ->where('tenant_id', $tenantId)
            ->whereKey($inviterId)
            ->first();
        $inviterName = $this->displayName($inviter);
        $results = array_merge($invalidResults, $committed['results']);

        foreach ($committed['mail_jobs'] as $inviteId => $job) {
            $delivered = $this->sendInviteEmail(
                $job['email'],
                $job['token'],
                $committed['group'],
                $inviterName,
                $message,
                $job['recipient'],
                $tenantId,
            );

            foreach ($results as &$result) {
                if ((int) ($result['invite']['id'] ?? 0) === (int) $inviteId) {
                    $result['email_delivered'] = $delivered;
                    break;
                }
            }
            unset($result);
        }

        return $results;
    }

    /** Return a non-mutating, tenant-scoped preview for the signed-in user. */
    public function previewInvite(string $token, int $userId): ?array
    {
        $this->errors = [];
        $tenantId = (int) TenantContext::getId();
        if (! $this->isValidToken($token)) {
            $this->errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.group_invite_not_found')];
            return null;
        }

        $user = User::query()
            ->where('tenant_id', $tenantId)
            ->whereKey($userId)
            ->first();
        if ($user === null) {
            $this->errors[] = ['code' => 'FORBIDDEN', 'message' => __('api.group_invite_forbidden')];
            return null;
        }

        $invite = DB::table('group_invites')
            ->where('tenant_id', $tenantId)
            ->where('token', $token)
            ->first();
        if (! $this->validateInviteForUser($invite, $user, false)) {
            return null;
        }

        /** @var Group|null $group */
        $group = Group::query()
            ->where('tenant_id', $tenantId)
            ->whereKey((int) $invite->group_id)
            ->first();
        if ($group === null || $group->status !== GroupStatus::Active || ! (bool) $group->is_active) {
            $this->errors[] = ['code' => 'GROUP_UNAVAILABLE', 'message' => __('api.group_invite_group_unavailable')];
            return null;
        }

        $membershipStatus = (string) (DB::table('group_members')
            ->where('tenant_id', $tenantId)
            ->where('group_id', (int) $group->id)
            ->where('user_id', $userId)
            ->value('status') ?? 'none');
        if ((string) $invite->status === self::STATUS_ACCEPTED
            && ((int) ($invite->accepted_by ?? 0) !== $userId || $membershipStatus !== 'active')) {
            $this->errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.group_invite_not_found')];
            return null;
        }

        return $this->previewPayload($invite, $group, $membershipStatus);
    }

    /** Atomically accept an invitation and activate membership. */
    public function acceptInvite(string $token, int $userId): ?array
    {
        $this->errors = [];
        $tenantId = (int) TenantContext::getId();
        if (! $this->isValidToken($token)) {
            $this->errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.group_invite_not_found')];
            return null;
        }

        $result = DB::transaction(function () use ($token, $userId, $tenantId): ?array {
            $invite = DB::table('group_invites')
                ->where('tenant_id', $tenantId)
                ->where('token', $token)
                ->lockForUpdate()
                ->first();
            if ($invite === null) {
                $this->errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.group_invite_not_found')];
                return null;
            }

            $group = $this->lockActiveInviteGroup((int) $invite->group_id, $tenantId);
            if ($group === null) {
                return null;
            }

            /** @var User|null $user */
            $user = User::query()
                ->where('tenant_id', $tenantId)
                ->whereKey($userId)
                ->lockForUpdate()
                ->first();
            if ($user === null) {
                $this->errors[] = ['code' => 'FORBIDDEN', 'message' => __('api.group_invite_forbidden')];
                return null;
            }
            if (! $this->validateInviteForUser($invite, $user, true)) {
                return null;
            }

            $membership = DB::table('group_members')
                ->where('tenant_id', $tenantId)
                ->where('group_id', (int) $group->id)
                ->where('user_id', $userId)
                ->lockForUpdate()
                ->first();
            if ((string) ($membership->status ?? '') === 'banned') {
                $this->errors[] = ['code' => 'FORBIDDEN', 'message' => __('api.group_banned')];
                return null;
            }

            if ((string) $invite->status === self::STATUS_ACCEPTED) {
                if ((int) ($invite->accepted_by ?? 0) === $userId && (string) ($membership->status ?? '') === 'active') {
                    $this->syncCachedMemberCount((int) $group->id, $tenantId);
                    return $this->acceptancePayload($invite, $group, 'already_member');
                }
                $this->errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.group_invite_not_found')];
                return null;
            }

            if ((string) ($membership->status ?? '') === 'active') {
                if ((string) $invite->invite_type === 'email') {
                    $this->markEmailInviteAccepted((int) $invite->id, $userId, $tenantId);
                    $invite->status = self::STATUS_ACCEPTED;
                }
                $this->syncCachedMemberCount((int) $group->id, $tenantId);
                return $this->acceptancePayload($invite, $group, 'already_member');
            }

            if (! $this->assertInviteMembershipCapacity($group, $userId, $tenantId)) {
                return null;
            }

            $inviterId = (int) ($invite->invited_by ?? 0);
            if ($inviterId > 0 && $inviterId !== $userId) {
                $policy = app(SafeguardingInteractionPolicy::class);
                $policy->assertLocalContactAllowed($inviterId, $userId, $tenantId, 'group_invitation_accept');
                $policy->assertLocalContactAllowed($userId, $inviterId, $tenantId, 'group_invitation_accept');
            }
            GroupService::assertSafeguardingCohortAllowed(
                (int) $group->id,
                $userId,
                $tenantId,
                'group_invitation_accept',
            );

            $now = now();
            if ($membership === null) {
                DB::table('group_members')->insert([
                    'tenant_id' => $tenantId,
                    'group_id' => (int) $group->id,
                    'user_id' => $userId,
                    'role' => 'member',
                    'status' => 'active',
                    'joined_at' => $now,
                    'created_at' => $now,
                    'updated_at' => $now,
                ]);
            } else {
                DB::table('group_members')
                    ->where('id', $membership->id)
                    ->where('tenant_id', $tenantId)
                    ->update([
                        'role' => 'member',
                        'status' => 'active',
                        'joined_at' => $now,
                        'updated_at' => $now,
                    ]);
            }

            if ((string) $invite->invite_type === 'email') {
                $this->markEmailInviteAccepted((int) $invite->id, $userId, $tenantId);
                $invite->status = self::STATUS_ACCEPTED;
            }
            GroupAuditService::log(
                GroupAuditService::ACTION_MEMBER_JOINED,
                (int) $group->id,
                $userId,
                [
                    'target_user_id' => $userId,
                    'source' => 'invite_acceptance',
                    'invite_id' => (int) $invite->id,
                    'invite_type' => (string) $invite->invite_type,
                    'invited_by' => (int) ($invite->invited_by ?? 0),
                ],
            );
            GroupWebhookService::fire(
                (int) $group->id,
                GroupWebhookService::EVENT_MEMBER_JOINED,
                ['user_id' => $userId, 'invite_id' => (int) $invite->id],
            );
            $this->syncCachedMemberCount((int) $group->id, $tenantId);

            return $this->acceptancePayload($invite, $group, 'joined');
        }, 3);

        if (($result['action'] ?? null) === 'joined') {
            $this->dispatchMembershipAcceptedEffects(
                (int) $result['group']['id'],
                $userId,
                $tenantId,
            );
        }

        return $result;
    }

    /** @return list<array<string, mixed>>|null */
    public function getPendingInvites(int $groupId, int $userId): ?array
    {
        $this->errors = [];
        $tenantId = (int) TenantContext::getId();
        if (! $this->canInvite($groupId, $userId)) {
            $this->errors[] = ['code' => 'FORBIDDEN', 'message' => __('api.group_invite_forbidden')];
            return null;
        }

        $this->expirePendingInvitesForGroup($groupId, $tenantId);

        return DB::table('group_invites as gi')
            ->leftJoin('users as u', function ($join) use ($tenantId): void {
                $join->on('gi.invited_by', '=', 'u.id')
                    ->where('u.tenant_id', '=', $tenantId);
            })
            ->where('gi.tenant_id', $tenantId)
            ->where('gi.group_id', $groupId)
            ->where('gi.status', self::STATUS_PENDING)
            ->where('gi.expires_at', '>', now())
            ->select([
                'gi.id',
                'gi.invite_type',
                'gi.email',
                'gi.token',
                'gi.status',
                'gi.expires_at',
                'gi.invited_by',
                'gi.created_at',
                'u.first_name as inviter_first_name',
                'u.last_name as inviter_last_name', 'u.profile_type as inviter_profile_type', 'u.organization_name as inviter_organization_name',
                'u.name as inviter_name',
            ])
            ->orderByDesc('gi.created_at')
            ->get()
            ->map(function ($row): array {
                $inviterName = UserDisplayName::resolvePrefixed($row, 'inviter_');
                if ($inviterName === '') {
                    $inviterName = (string) ($row->inviter_name ?? '');
                }

                return [
                    'id' => (int) $row->id,
                    'type' => (string) $row->invite_type,
                    'invite_type' => (string) $row->invite_type,
                    'email' => $row->email,
                    'status' => (string) $row->status,
                    'invite_url' => (string) $row->invite_type === 'link'
                        ? $this->buildInviteUrl((string) $row->token)
                        : null,
                    'expires_at' => CarbonImmutable::parse($row->expires_at)->toIso8601String(),
                    'created_at' => CarbonImmutable::parse($row->created_at)->toIso8601String(),
                    'invited_by' => (int) $row->invited_by,
                    'inviter_name' => $inviterName,
                    'inviter' => [
                        'id' => (int) $row->invited_by,
                        'name' => $inviterName,
                    ],
                    'capabilities' => ['can_revoke' => true],
                ];
            })
            ->all();
    }

    public function revokeInvite(int $groupId, int $inviteId, int $userId): bool
    {
        $this->errors = [];
        $tenantId = (int) TenantContext::getId();
        if (! $this->canInvite($groupId, $userId)) {
            $this->errors[] = ['code' => 'FORBIDDEN', 'message' => __('api.group_invite_forbidden')];
            return false;
        }

        return DB::transaction(function () use ($groupId, $inviteId, $userId, $tenantId): bool {
            if ($this->lockActiveInviteGroup($groupId, $tenantId) === null) {
                return false;
            }

            $invite = DB::table('group_invites')
                ->where('tenant_id', $tenantId)
                ->where('group_id', $groupId)
                ->where('id', $inviteId)
                ->where('status', self::STATUS_PENDING)
                ->where('expires_at', '>', now())
                ->lockForUpdate()
                ->first(['id', 'invite_type', 'status', 'invited_by']);
            if ($invite === null) {
                $this->errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.group_invite_revoke_not_found')];
                return false;
            }

            $affected = DB::table('group_invites')
                ->where('tenant_id', $tenantId)
                ->where('group_id', $groupId)
                ->where('id', $inviteId)
                ->where('status', self::STATUS_PENDING)
                ->update(['status' => self::STATUS_REVOKED, 'updated_at' => now()]);
            if ($affected !== 1) {
                $this->errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.group_invite_revoke_not_found')];
                return false;
            }

            GroupAuditService::log(
                GroupAuditService::ACTION_INVITE_REVOKED,
                $groupId,
                $userId,
                [
                    'invite_id' => $inviteId,
                    'invite_type' => (string) $invite->invite_type,
                    'previous_status' => (string) $invite->status,
                    'invited_by' => (int) ($invite->invited_by ?? 0),
                ],
            );

            return true;
        }, 3);
    }

    private function canInvite(int $groupId, int $userId): bool
    {
        return GroupAccessService::canManageMembers($groupId, $userId);
    }

    private function lockActiveInviteGroup(int $groupId, int $tenantId): ?Group
    {
        /** @var Group|null $group */
        $group = Group::query()
            ->where('tenant_id', $tenantId)
            ->whereKey($groupId)
            ->lockForUpdate()
            ->first();
        if ($group === null) {
            $this->errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.group_not_found')];
            return null;
        }
        if ($group->status !== GroupStatus::Active || ! (bool) $group->is_active) {
            $this->errors[] = ['code' => 'GROUP_UNAVAILABLE', 'message' => __('api.group_invite_group_unavailable')];
            return null;
        }

        return $group;
    }

    /** @param array<string, mixed> $attributes @return array{0: int, 1: string} */
    private function insertInvite(array $attributes): array
    {
        for ($attempt = 0; $attempt < 3; ++$attempt) {
            $token = Str::random(40);
            try {
                $inviteId = DB::table('group_invites')->insertGetId($attributes + ['token' => $token]);
                return [(int) $inviteId, $token];
            } catch (UniqueConstraintViolationException) {
                // Regenerate the opaque token on the astronomically unlikely collision.
            }
        }

        throw new RuntimeException('Unable to allocate a unique group invite token');
    }

    private function expirePendingInvitesForGroup(int $groupId, int $tenantId): void
    {
        DB::table('group_invites')
            ->where('tenant_id', $tenantId)
            ->where('group_id', $groupId)
            ->where('status', self::STATUS_PENDING)
            ->whereNotNull('expires_at')
            ->where('expires_at', '<=', now())
            ->update(['status' => self::STATUS_EXPIRED, 'updated_at' => now()]);
    }

    private function pendingInviteCount(int $groupId, int $tenantId): int
    {
        return DB::table('group_invites')
            ->where('tenant_id', $tenantId)
            ->where('group_id', $groupId)
            ->where('status', self::STATUS_PENDING)
            ->where('expires_at', '>', now())
            ->count();
    }

    private function validateInviteForUser(?object $invite, User $user, bool $markExpired): bool
    {
        if ($invite === null) {
            $this->errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.group_invite_not_found')];
            return false;
        }

        $status = (string) $invite->status;
        if ($status === self::STATUS_REVOKED) {
            $this->errors[] = ['code' => 'REVOKED', 'message' => __('api.group_invite_revoked')];
            return false;
        }
        if ($status === self::STATUS_EXPIRED
            || ($status === self::STATUS_PENDING
                && $invite->expires_at !== null
                && now()->greaterThanOrEqualTo($invite->expires_at))) {
            if ($markExpired && $status === self::STATUS_PENDING) {
                DB::table('group_invites')
                    ->where('tenant_id', (int) $user->tenant_id)
                    ->where('id', (int) $invite->id)
                    ->where('status', self::STATUS_PENDING)
                    ->update(['status' => self::STATUS_EXPIRED, 'updated_at' => now()]);
            }
            $this->errors[] = ['code' => 'EXPIRED', 'message' => __('api.group_invite_expired')];
            return false;
        }
        if (! in_array($status, [self::STATUS_PENDING, self::STATUS_ACCEPTED], true)) {
            $this->errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.group_invite_not_found')];
            return false;
        }
        if ((string) $invite->invite_type === 'email'
            && strtolower((string) $invite->email) !== strtolower((string) $user->email)) {
            $this->errors[] = ['code' => 'EMAIL_MISMATCH', 'message' => __('api.group_invite_email_mismatch')];
            return false;
        }

        return true;
    }

    private function assertInviteMembershipCapacity(Group $group, int $userId, int $tenantId): bool
    {
        $maxGroups = (int) GroupConfigurationService::get(
            GroupConfigurationService::CONFIG_MAX_GROUPS_PER_USER,
            10,
        );
        if ($maxGroups > 0 && DB::table('group_members')
            ->where('tenant_id', $tenantId)
            ->where('user_id', $userId)
            ->where('status', 'active')
            ->count() >= $maxGroups) {
            $this->errors[] = [
                'code' => 'MEMBERSHIP_LIMIT_REACHED',
                'message' => __('api.group_membership_limit_reached'),
            ];
            return false;
        }

        $activeMemberCount = DB::table('group_members')
            ->where('tenant_id', $tenantId)
            ->where('group_id', (int) $group->id)
            ->where('status', 'active')
            ->count();
        $maxMembers = max(1, (int) GroupConfigurationService::get(
            GroupConfigurationService::CONFIG_MAX_MEMBERS_PER_GROUP,
            500,
        ));
        if ($activeMemberCount >= $maxMembers) {
            DB::table('groups')
                ->where('tenant_id', $tenantId)
                ->where('id', (int) $group->id)
                ->update(['cached_member_count' => $activeMemberCount]);
            $this->errors[] = ['code' => 'CAPACITY_FULL', 'message' => __('api.group_capacity_full')];
            return false;
        }

        return true;
    }

    private function syncCachedMemberCount(int $groupId, int $tenantId): int
    {
        $count = DB::table('group_members')
            ->where('tenant_id', $tenantId)
            ->where('group_id', $groupId)
            ->where('status', 'active')
            ->count();
        DB::table('groups')
            ->where('tenant_id', $tenantId)
            ->where('id', $groupId)
            ->update(['cached_member_count' => $count]);

        return $count;
    }

    private function markEmailInviteAccepted(int $inviteId, int $userId, int $tenantId): void
    {
        DB::table('group_invites')
            ->where('tenant_id', $tenantId)
            ->where('id', $inviteId)
            ->where('invite_type', 'email')
            ->where('status', self::STATUS_PENDING)
            ->update([
                'status' => self::STATUS_ACCEPTED,
                'accepted_by' => $userId,
                'accepted_at' => now(),
                'updated_at' => now(),
            ]);
    }

    /** @return array<string, mixed> */
    private function previewPayload(object $invite, Group $group, string $membershipStatus): array
    {
        return [
            'invite' => [
                'id' => (int) $invite->id,
                'type' => (string) $invite->invite_type,
                'status' => (string) $invite->status,
                'email_bound' => (string) $invite->invite_type === 'email',
                'expires_at' => CarbonImmutable::parse($invite->expires_at)->toIso8601String(),
            ],
            'group' => [
                'id' => (int) $group->id,
                'name' => (string) $group->name,
                'image_url' => $group->image_url,
                'visibility' => (string) $group->visibility,
                'member_count' => (int) $group->cached_member_count,
            ],
            'membership' => [
                'status' => in_array($membershipStatus, ['active', 'pending', 'invited', 'banned'], true)
                    ? $membershipStatus
                    : 'none',
            ],
        ];
    }

    /** @return array<string, mixed> */
    private function acceptancePayload(object $invite, Group $group, string $action): array
    {
        return [
            'action' => $action,
            'group' => ['id' => (int) $group->id, 'name' => (string) $group->name],
            'membership' => ['status' => 'active', 'role' => 'member'],
            'invite' => [
                'id' => (int) $invite->id,
                'type' => (string) $invite->invite_type,
                'status' => (string) $invite->status,
            ],
        ];
    }

    private function dispatchMembershipAcceptedEffects(
        int $groupId,
        int $userId,
        int $tenantId,
    ): void {
        TenantContext::runForTenant($tenantId, function () use ($groupId, $userId, $tenantId): void {
            $recipient = User::query()
                ->where('tenant_id', $tenantId)
                ->whereKey($userId)
                ->first();

            LocaleContext::withLocale($recipient, function () use ($groupId, $userId, $tenantId): void {
                try { GroupWelcomeService::sendWelcome($groupId, $userId); } catch (\Throwable $e) { Log::warning('GroupInviteService: welcome failed after acceptance', ['group_id' => $groupId, 'user_id' => $userId, 'error' => $e->getMessage()]); }
                try { GroupChallengeService::incrementProgress($groupId, 'members'); } catch (\Throwable $e) { Log::warning('GroupInviteService: challenge progress failed after acceptance', ['group_id' => $groupId, 'error' => $e->getMessage()]); }
                try { GroupMemberJoined::dispatch($groupId, $userId, $tenantId); } catch (\Throwable $e) { Log::warning('GroupInviteService: GroupMemberJoined dispatch failed', ['group_id' => $groupId, 'user_id' => $userId, 'error' => $e->getMessage()]); }
                try { app(GroupNotificationService::class)->notifyJoined($groupId, $userId); } catch (\Throwable $e) { Log::warning('GroupInviteService: joined notification failed', ['group_id' => $groupId, 'user_id' => $userId, 'error' => $e->getMessage()]); }
                try { GamificationService::awardXP($userId, GamificationService::XP_VALUES['join_group'], 'join_group', __('api.group_joined')); } catch (\Throwable $e) { Log::warning('GroupInviteService: join XP failed', ['group_id' => $groupId, 'user_id' => $userId, 'error' => $e->getMessage()]); }
            });
        });
    }

    private function sendInviteEmail(
        string $email,
        string $token,
        Group $group,
        string $inviterName,
        string $message,
        ?User $recipient,
        int $tenantId,
    ): bool {
        try {
            return LocaleContext::withLocale($recipient, function () use (
                $email,
                $token,
                $group,
                $inviterName,
                $message,
                $tenantId,
            ): bool {
                $subject = __('emails_misc.group_invite.email_subject', ['group' => $group->name]);
                $body = __('emails_misc.group_invite.email_body', [
                    'inviter' => htmlspecialchars($inviterName, ENT_QUOTES, 'UTF-8'),
                    'group' => htmlspecialchars((string) $group->name, ENT_QUOTES, 'UTF-8'),
                ]);
                $builder = EmailTemplateBuilder::make()
                    ->title(__('emails_misc.group_invite.email_title'))
                    ->greeting(__('emails_misc.group_invite.email_greeting'))
                    ->paragraph($body);
                if ($message !== '') {
                    $builder->paragraph('<em>' . htmlspecialchars($message, ENT_QUOTES, 'UTF-8') . '</em>');
                }
                $html = $builder
                    ->button(__('emails_misc.group_invite.email_cta'), $this->buildInviteUrl($token))
                    ->render();

                return \App\Services\EmailDispatchService::sendRaw(
                    $email,
                    $subject,
                    $html,
                    null,
                    null,
                    null,
                    'group_invite',
                    ['tenant_id' => $tenantId],
                );
            });
        } catch (\Throwable $e) {
            Log::warning('GroupInviteService: invite email delivery failed', [
                'email' => $email,
                'group_id' => (int) $group->id,
                'error' => $e->getMessage(),
            ]);
            return false;
        }
    }

    private function displayName(?User $user): string
    {
        if ($user === null) {
            return __('emails.common.fallback_member_name');
        }
        $name = UserDisplayName::resolve($user);
        return $name !== '' ? $name : (string) ($user->name ?: __('emails.common.fallback_member_name'));
    }

    private function isValidToken(string $token): bool
    {
        return preg_match('/^[A-Za-z0-9]{40}$/', $token) === 1;
    }

    private function buildInviteUrl(string $token): string
    {
        return rtrim(TenantContext::getFrontendUrl(), '/')
            . TenantContext::getSlugPrefix()
            . '/groups/invite/'
            . $token;
    }
}
