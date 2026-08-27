<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services\AI\Tools;

use App\Core\TenantContext;
use Illuminate\Support\Facades\DB;
use App\Support\UserDisplayName;

/**
 * Search active members by skill, location, or free-text bio match.
 *
 * Privacy: returns public profile fields only — never email or phone.
 */
class SearchMembersTool extends AbstractTool
{
    public function name(): string
    {
        return 'search_members';
    }

    public function description(): string
    {
        return 'Find community members by skill, location, or interest. Use this when the user asks "who can help with X" or "find a [profession] near [place]". Returns up to 8 active members with public profile info only (no email or phone).';
    }

    public function parametersSchema(): array
    {
        return [
            'type' => 'object',
            'properties' => [
                'query' => [
                    'type' => 'string',
                    'description' => 'Skill, profession, language, or interest to search for (e.g. "electrician", "Polish speaker", "guitar").',
                ],
                'location' => [
                    'type' => 'string',
                    'description' => 'Optional location filter (city, town, or area).',
                ],
                'limit' => [
                    'type' => 'integer',
                    'description' => 'Max results (1-8, default 5).',
                ],
            ],
            'required' => ['query'],
        ];
    }

    public function execute(array $arguments, int $userId): array
    {
        $tenantId = $this->tenantId();
        $query = $this->stringArg($arguments, 'query');
        $location = $this->stringArg($arguments, 'location');
        $limit = $this->intArg($arguments, 'limit', 5, 1, 8);

        if ($query === '') {
            return $this->err('A non-empty query is required.');
        }

        $like = '%' . str_replace(['%', '_'], ['\%', '\_'], $query) . '%';

        $q = DB::table('users')
            ->where('tenant_id', $tenantId)
            ->where('status', 'active')
            ->where('id', '!=', $userId)
            ->where(function ($q) use ($like) {
                $q->where('skills', 'LIKE', $like)
                  ->orWhere('bio', 'LIKE', $like)
                  ->orWhere('tagline', 'LIKE', $like)
                  ->orWhere('first_name', 'LIKE', $like)
                  ->orWhere('last_name', 'LIKE', $like)
                  ->orWhere('organization_name', 'LIKE', $like);
            });

        if ($location !== '') {
            $locLike = '%' . str_replace(['%', '_'], ['\%', '\_'], $location) . '%';
            $q->where('location', 'LIKE', $locLike);
        }

        $rows = $q->orderByDesc('updated_at')
            ->limit($limit)
            ->get([
                'id', 'first_name', 'last_name', 'username',
                'organization_name', 'profile_type',
                'tagline', 'bio', 'location', 'skills', 'avatar_url',
            ]);

        if ($rows->isEmpty()) {
            return $this->ok('No members matched "' . $query . '".', [], 'member');
        }

        $slugPrefix = TenantContext::getSlugPrefix();
        $results = $rows->map(function ($r) use ($slugPrefix) {
            // Was comparing against 'organization' (AMERICAN spelling), which
            // never matches the stored 'organisation'.
            $displayName = UserDisplayName::resolve($r);
            return [
                'id' => (int) $r->id,
                'name' => $displayName !== '' ? $displayName : ($r->username ?? ('Member #' . $r->id)),
                'profile_type' => (string) ($r->profile_type ?? 'individual'),
                'tagline' => $r->tagline,
                'location' => $r->location,
                'skills' => $r->skills ? mb_substr((string) $r->skills, 0, 200) : null,
                'bio_excerpt' => $r->bio ? mb_substr(strip_tags((string) $r->bio), 0, 160) : null,
                'avatar_url' => $r->avatar_url,
                'url' => $slugPrefix . '/profile/' . (int) $r->id,
            ];
        })->all();

        return $this->ok(
            sprintf('Found %d member(s) matching "%s".', count($results), $query),
            $results,
            'member'
        );
    }
}
