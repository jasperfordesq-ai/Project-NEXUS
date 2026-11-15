<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

use App\Models\User;
use Illuminate\Support\Facades\Broadcast;

/*
|--------------------------------------------------------------------------
| Broadcast Channels
|--------------------------------------------------------------------------
|
| All channels are tenant-scoped to prevent cross-tenant data leakage.
| The channel name format is: tenant.{tenantId}.resource.{resourceId}
|
*/

// Private user notification channel — user can only listen to their own
Broadcast::channel('tenant.{tenantId}.user.{userId}', function (User $user, int $tenantId, int $userId) {
    return $user->id === $userId && $user->tenant_id === $tenantId;
});

// Private conversation channel — both participants can listen
Broadcast::channel('tenant.{tenantId}.conversation.{conversationId}', function (User $user, $tenantId, $conversationId) {
    // Validate numeric inputs
    if (!is_numeric($tenantId) || !is_numeric($conversationId)) return false;
    $tenantId = (int) $tenantId;
    $conversationId = (int) $conversationId;

    if ($user->tenant_id !== $tenantId) return false;

    // Verify the conversation exists in this tenant
    $conversation = \Illuminate\Support\Facades\DB::table('messages')
        ->where('id', $conversationId)
        ->where('tenant_id', $tenantId)
        ->first();

    if (!$conversation) return false;

    // Check user is a participant (sender or receiver)
    return \Illuminate\Support\Facades\DB::table('messages')
        ->where('id', $conversationId)
        ->where('tenant_id', $tenantId)
        ->where(function ($q) use ($user) {
            $q->where('sender_id', $user->id)->orWhere('receiver_id', $user->id);
        })
        ->exists();
});

// Private group channel — group members only
Broadcast::channel('tenant.{tenantId}.group.{groupId}', function (User $user, int $tenantId, int $groupId) {
    if ($user->tenant_id !== $tenantId) {
        return false;
    }
    return \Illuminate\Support\Facades\DB::table('group_members')
        ->where('group_id', $groupId)
        ->where('user_id', $user->id)
        ->where('status', 'active')
        ->exists();
});

// Private feed channel — any authenticated member in the tenant
Broadcast::channel('tenant.{tenantId}.feed', function (User $user, int $tenantId) {
    return $user->tenant_id === $tenantId;
});

// Private chat channel — only the two participants (deterministic ID pair)
Broadcast::channel('tenant.{tenantId}.chat.{chatId}', function (User $user, int $tenantId, string $chatId) {
    if ($user->tenant_id !== $tenantId) {
        return false;
    }
    // chatId is "{smallerUserId}-{largerUserId}" — user must be one of them
    $parts = explode('-', $chatId);
    if (count($parts) !== 2) return false;
    $userA = (int) $parts[0];
    $userB = (int) $parts[1];
    if ($userA <= 0 || $userB <= 0) return false;
    return $user->id === $userA || $user->id === $userB;
});

// Prerender engine channel — broadcasts job lifecycle updates across every
// community. The platform team only (is_god AND super admin), the same rule as
// the Prerender engine's endpoints (E-128).
Broadcast::channel('admin-prerender', function (User $user) {
    return \App\Support\Authorization\PlatformTeam::includes((int) $user->id);
});

// Presence channel for online members in a tenant
Broadcast::channel('tenant.{tenantId}.presence', function (User $user, int $tenantId) {
    if ($user->tenant_id !== $tenantId) {
        return false;
    }
    return [
        'id' => $user->id,
        'name' => $user->name,
        'avatar_url' => $user->avatar_url,
    ];
});
