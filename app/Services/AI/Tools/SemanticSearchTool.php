<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services\AI\Tools;

use App\Core\TenantContext;
use App\Services\EmbeddingService;
use App\Support\Events\EventSearchVisibility;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;
use App\Support\UserDisplayName;

/**
 * Semantic search across all indexed content types using OpenAI embeddings.
 *
 * The keyword search_* tools should usually be tried first because they're
 * cheaper. This tool is the fallback when the user's question is vague or
 * uses synonyms the keyword search would miss (e.g. "things to do with kids
 * this weekend", "someone who can sort my paperwork").
 */
class SemanticSearchTool extends AbstractTool
{
    private const TYPE_MAP = [
        'listing' => ['table' => 'listings', 'card_type' => 'listing'],
        'user' => ['table' => 'users', 'card_type' => 'member'],
        'event' => ['table' => 'events', 'card_type' => 'event'],
        'group' => ['table' => 'groups', 'card_type' => 'generic'],
        'job' => ['table' => 'job_vacancies', 'card_type' => 'job'],
        'marketplace' => ['table' => 'marketplace_listings', 'card_type' => 'marketplace'],
        'kb_article' => ['table' => 'knowledge_base_articles', 'card_type' => 'kb'],
    ];

    public function __construct(private readonly ?EmbeddingService $embeddings = null) {}

    public function name(): string
    {
        return 'semantic_search';
    }

    public function description(): string
    {
        return 'Semantic (meaning-based) search across all indexed content (listings, members, events, jobs, marketplace, KB, groups). Use as a fallback when the more specific keyword search_* tools return nothing and the question is loosely worded or uses synonyms. Returns the best matches across all types ranked by semantic similarity.';
    }

    public function parametersSchema(): array
    {
        return [
            'type' => 'object',
            'properties' => [
                'query' => [
                    'type' => 'string',
                    'description' => 'Natural-language description of what the user is looking for.',
                ],
                'types' => [
                    'type' => 'array',
                    'items' => ['type' => 'string', 'enum' => ['listing', 'user', 'event', 'group', 'job', 'marketplace', 'kb_article']],
                    'description' => 'Optional restriction to specific content types. Default: search all types.',
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
        $types = array_values(array_intersect(array_keys(self::TYPE_MAP), $this->arrayArg($arguments, 'types')));
        $limit = $this->intArg($arguments, 'limit', 5, 1, 8);

        if ($query === '') {
            return $this->err('A non-empty query is required.');
        }

        $service = $this->embeddings ?? app(EmbeddingService::class);
        $hits = $service->semanticSearch($query, $tenantId, $types, $limit);

        if ($hits === []) {
            return $this->ok('No semantic matches found for "' . $query . '".', [], 'generic');
        }

        $hydrated = $this->hydrate($hits, $tenantId, $userId);
        $cardType = count(array_unique(array_column($hydrated, '_card_type'))) === 1
            ? $hydrated[0]['_card_type']
            : 'generic';

        foreach ($hydrated as &$item) {
            unset($item['_card_type']);
        }

        return $this->ok(
            sprintf('Found %d semantic match(es) for "%s".', count($hydrated), $query),
            $hydrated,
            $cardType
        );
    }

    /**
     * Turn (content_type, content_id) hits into renderable cards by joining
     * back to the source tables. Preserves the semantic-score order.
     *
     * @param array<int, array{content_type:string, content_id:int, score:float}> $hits
     * @return array<int, array<string, mixed>>
     */
    private function hydrate(array $hits, int $tenantId, int $userId): array
    {
        $slugPrefix = TenantContext::getSlugPrefix();
        $byType = [];
        foreach ($hits as $i => $hit) {
            $byType[$hit['content_type']][$hit['content_id']] = $i;
        }

        $byId = [];
        foreach ($byType as $type => $ids) {
            if (!isset(self::TYPE_MAP[$type])) {
                continue;
            }
            $table = self::TYPE_MAP[$type]['table'];
            $query = DB::table($table)
                ->where('tenant_id', $tenantId)
                ->whereIn('id', array_keys($ids));
            $this->applyVisibilityFilters($query, $type, $userId, $tenantId);
            $rows = $query->get();
            foreach ($rows as $row) {
                $byId[$type][(int) $row->id] = $row;
            }
        }

        $out = [];
        foreach ($hits as $hit) {
            $row = $byId[$hit['content_type']][$hit['content_id']] ?? null;
            if (!$row) {
                continue;
            }
            $card = $this->rowToCard($hit['content_type'], $row, $slugPrefix);
            if ($card === null) {
                continue;
            }
            $card['score'] = round($hit['score'], 3);
            $card['_card_type'] = self::TYPE_MAP[$hit['content_type']]['card_type'];
            $out[] = $card;
        }
        return $out;
    }

    private function applyVisibilityFilters(
        Builder $query,
        string $type,
        int $userId,
        int $tenantId,
    ): void
    {
        switch ($type) {
            case 'listing':
                $query->where('status', 'active')
                    ->where(function ($q) {
                        $q->whereNull('moderation_status')
                            ->orWhere('moderation_status', 'approved');
                    });
                break;

            case 'user':
                $query->where('status', 'active')
                    ->where('id', '!=', $userId);
                break;

            case 'event':
                EventSearchVisibility::applyToQuery($query, $tenantId, 'events')
                    ->where('events.start_time', '>=', now());
                break;

            case 'group':
                $query->where('visibility', 'public')
                    ->where('is_active', 1)
                    ->where('status', 'active');
                break;

            case 'job':
                $query->whereIn('status', ['active', 'open'])
                    ->where(function ($q) {
                        $q->whereNull('moderation_status')
                            ->orWhere('moderation_status', 'approved');
                    })
                    ->where(function ($q) {
                        $q->whereNull('expired_at')
                            ->orWhere('expired_at', '>', now());
                    });
                break;

            case 'marketplace':
                $query->where('status', 'active')
                    ->where(function ($q) {
                        $q->whereNull('moderation_status')
                            ->orWhere('moderation_status', 'approved');
                    });
                break;

            case 'kb_article':
                $query->where('is_published', true);
                break;
        }
    }

    private function rowToCard(string $type, $row, string $slugPrefix): ?array
    {
        switch ($type) {
            case 'listing':
                return [
                    'id' => (int) $row->id,
                    'title' => (string) $row->title,
                    'type' => $row->type ?? null,
                    'location' => $row->location ?? null,
                    'excerpt' => mb_substr(strip_tags((string) ($row->description ?? '')), 0, 180),
                    'url' => $slugPrefix . '/listings/' . (int) $row->id,
                ];
            case 'user':
                $name = UserDisplayName::resolve($row);
                return [
                    'id' => (int) $row->id,
                    'name' => $name !== '' ? $name : ('Member #' . $row->id),
                    'tagline' => $row->tagline ?? null,
                    'location' => $row->location ?? null,
                    'skills' => isset($row->skills) ? mb_substr((string) $row->skills, 0, 160) : null,
                    'url' => $slugPrefix . '/profile/' . (int) $row->id,
                ];
            case 'event':
                return [
                    'id' => (int) $row->id,
                    'title' => (string) $row->title,
                    'start_time' => $row->start_time ?? null,
                    'is_online' => isset($row->is_online) ? (bool) $row->is_online : false,
                    'location' => $row->location ?? null,
                    'url' => $slugPrefix . '/events/' . (int) $row->id,
                ];
            case 'job':
                return [
                    'id' => (int) $row->id,
                    'title' => (string) $row->title,
                    'tagline' => $row->tagline ?? null,
                    'is_remote' => isset($row->is_remote) ? (bool) $row->is_remote : false,
                    'location' => $row->location ?? null,
                    'excerpt' => mb_substr(strip_tags((string) ($row->description ?? '')), 0, 160),
                    'url' => $slugPrefix . '/jobs/' . (int) $row->id,
                ];
            case 'marketplace':
                return [
                    'id' => (int) $row->id,
                    'title' => (string) $row->title,
                    'tagline' => $row->tagline ?? null,
                    'condition' => $row->condition ?? null,
                    'price' => isset($row->price) ? (($row->price_currency ?? 'EUR') . ' ' . $row->price) : null,
                    'time_credit_price' => $row->time_credit_price ?? null,
                    'location' => $row->location ?? null,
                    'url' => $slugPrefix . '/marketplace/' . (int) $row->id,
                ];
            case 'kb_article':
                $plain = trim(preg_replace('/\s+/u', ' ', html_entity_decode(strip_tags((string) ($row->content ?? '')))) ?? '');
                return [
                    'id' => (int) $row->id,
                    'title' => (string) $row->title,
                    'excerpt' => mb_substr($plain, 0, 240),
                    'url' => $slugPrefix . '/kb/' . (int) $row->id,
                ];
            case 'group':
                return [
                    'id' => (int) $row->id,
                    'title' => (string) ($row->name ?? ''),
                    'excerpt' => mb_substr(strip_tags((string) ($row->description ?? '')), 0, 160),
                    'url' => $slugPrefix . '/groups/' . (int) $row->id,
                ];
        }
        return null;
    }
}
