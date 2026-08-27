<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services\AI;

use Illuminate\Support\Facades\DB;
use App\Support\UserDisplayName;

/**
 * Compact "who am I" snapshot of the calling user, injected into every
 * AI chat turn as system context. This is what lets the model personalise
 * replies — addressing the user by first name, knowing their skills,
 * referencing their balance, suggesting things consistent with their
 * recent activity.
 *
 * Privacy: only fields the user has already chosen to share publicly are
 * included. No email, phone, or DOB. Tenant-scoped.
 */
class AiUserMemoryService
{
    public function buildPrompt(int $tenantId, int $userId): string
    {
        $user = DB::table('users')
            ->where('id', $userId)
            ->where('tenant_id', $tenantId)
            ->first([
                'first_name', 'last_name', 'organization_name', 'profile_type',
                'preferred_language', 'tagline', 'location', 'skills', 'balance', 'role',
            ]);
        if (!$user) {
            return '';
        }

        // This compared profile_type against 'organization' (AMERICAN spelling),
        // which never matches the stored value 'organisation' -- so an
        // organisation's AI memory carried its contact person's name.
        $name = UserDisplayName::resolve($user);
        $displayName = $name !== '' ? $name : null;

        $recentListingTitles = DB::table('listings')
            ->where('tenant_id', $tenantId)
            ->where('user_id', $userId)
            ->where('status', 'active')
            ->orderByDesc('created_at')
            ->limit(3)
            ->pluck('title')
            ->all();

        $lines = ['## Current user'];
        if ($displayName) {
            $lines[] = '- Name: ' . $displayName;
        }
        $lines[] = '- Role: ' . ($user->role ?? 'member');
        if ($user->profile_type) {
            $lines[] = '- Profile type: ' . $user->profile_type;
        }
        if ($user->preferred_language) {
            $lines[] = '- Preferred language code: ' . $user->preferred_language . ' (reply in this language)';
        }
        if ($user->location) {
            $lines[] = '- Location: ' . $user->location;
        }
        if ($user->skills) {
            $skills = mb_substr((string) $user->skills, 0, 200);
            $lines[] = '- Skills: ' . $skills;
        }
        if ($user->tagline) {
            $lines[] = '- Tagline: ' . $user->tagline;
        }
        if (isset($user->balance)) {
            $lines[] = '- Time credit balance: ' . number_format((float) $user->balance, 2) . ' hours (do not mention unless the user asks)';
        }
        if ($recentListingTitles !== []) {
            $lines[] = '- Recent listings the user has posted: ' . implode('; ', array_map('strval', $recentListingTitles));
        }
        $lines[] = '';
        $lines[] = 'Use these facts to personalise. Address the user by first name when natural. Reply in the user\'s preferred language if set, otherwise mirror the language they wrote in.';

        return implode("\n", $lines);
    }
}
