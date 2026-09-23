<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services\AI\Tools;

use App\Core\TenantContext;
use App\Services\TenantFeatureConfig;
use App\Support\Events\EventSearchVisibility;
use Illuminate\Support\Facades\DB;

class SearchEventsTool extends AbstractTool
{
    public function name(): string
    {
        return 'search_events';
    }

    public function description(): string
    {
        return 'Find upcoming community events. Use when the user asks "what is on", "events near me", or asks about a specific event topic. Only returns events starting in the future.';
    }

    public function parametersSchema(): array
    {
        return [
            'type' => 'object',
            'properties' => [
                'query' => [
                    'type' => 'string',
                    'description' => 'Optional free-text query — topic, name, or area. Leave empty to list all upcoming events.',
                ],
                'location' => ['type' => 'string', 'description' => 'Optional location filter.'],
                'limit' => ['type' => 'integer', 'description' => 'Max results (1-8, default 5).'],
            ],
            'required' => [],
        ];
    }

    public function isAvailable(int $userId): bool
    {
        $tenant = TenantContext::get() ?: [];
        $features = $tenant['features'] ?? null;
        if (is_string($features)) {
            $features = json_decode($features, true) ?: [];
        }
        $merged = TenantFeatureConfig::mergeFeatures(is_array($features) ? $features : []);
        return !empty($merged['events']);
    }

    public function execute(array $arguments, int $userId): array
    {
        $tenantId = $this->tenantId();
        $query = $this->stringArg($arguments, 'query');
        $location = $this->stringArg($arguments, 'location');
        $limit = $this->intArg($arguments, 'limit', 5, 1, 8);

        $q = DB::table('events')->where('start_time', '>=', now());
        EventSearchVisibility::applyToQuery($q, $tenantId, 'events');
        // F-079: only events whose group audience includes the chatting member
        // (no group, an active public group, or one they own/belong to/admin).
        EventSearchVisibility::applyAudienceToQuery($q, $tenantId, $userId, 'events');

        if ($query !== '') {
            $like = '%' . str_replace(['%', '_'], ['\%', '\_'], $query) . '%';
            $q->where(function ($q) use ($like) {
                $q->where('title', 'LIKE', $like)->orWhere('description', 'LIKE', $like);
            });
        }
        if ($location !== '') {
            $locLike = '%' . str_replace(['%', '_'], ['\%', '\_'], $location) . '%';
            $q->where('location', 'LIKE', $locLike);
        }

        $rows = $q->orderBy('start_time')
            ->limit($limit)
            ->get(['id', 'title', 'description', 'start_time', 'end_time', 'location', 'is_online', 'max_attendees']);

        if ($rows->isEmpty()) {
            $msg = $query !== '' ? 'No upcoming events matched "' . $query . '".' : 'No upcoming events.';
            return $this->ok($msg, [], 'event');
        }

        $slugPrefix = TenantContext::getSlugPrefix();
        $results = $rows->map(fn ($r) => [
            'id' => (int) $r->id,
            'title' => (string) $r->title,
            'start_time' => (string) $r->start_time,
            'end_time' => $r->end_time,
            'location' => $r->location,
            'is_online' => (bool) $r->is_online,
            'excerpt' => mb_substr(strip_tags((string) ($r->description ?? '')), 0, 160),
            'url' => $slugPrefix . '/events/' . (int) $r->id,
        ])->all();

        return $this->ok(sprintf('Found %d upcoming event(s).', count($results)), $results, 'event');
    }
}
