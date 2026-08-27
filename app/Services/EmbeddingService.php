<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use App\Support\UserDisplayName;

/**
 * EmbeddingService — Semantic Vector Embeddings
 *
 * Uses OpenAI text-embedding-3-small to generate vector representations of
 * listings and user profiles, enabling semantic similarity search beyond
 * simple keyword matching.
 *
 * Embeddings are persisted in the content_embeddings table and retrieved via
 * cosine similarity.
 *
 * Algorithm references:
 *   - OpenAI embeddings: https://platform.openai.com/docs/guides/embeddings
 *   - Cosine similarity: https://en.wikipedia.org/wiki/Cosine_similarity
 */
class EmbeddingService
{
    private const MODEL = 'text-embedding-3-small';

    // =========================================================================
    // GENERATE & STORE
    // =========================================================================

    /**
     * Generate and persist an embedding for a listing.
     *
     * @param array $listing Listing row (must have id, title, description, tenant_id)
     */
    public function generateForListing(array $listing): void
    {
        $text = $this->listingToText($listing);
        $this->store((int) $listing['tenant_id'], 'listing', (int) $listing['id'], $text);
    }

    /**
     * Generate and persist an embedding for a user profile.
     *
     * @param array $user User row (must have id, bio, skills, tenant_id)
     */
    public function generateForUser(array $user): void
    {
        $text = $this->userToText($user);
        $this->store((int) $user['tenant_id'], 'user', (int) $user['id'], $text);
    }

    public function generateForEvent(array $event): void
    {
        $text = implode('. ', array_filter([
            $event['title'] ?? '', $event['description'] ?? '', $event['location'] ?? '',
        ]));
        $this->store((int) $event['tenant_id'], 'event', (int) $event['id'], $text);
    }

    public function generateForGroup(array $group): void
    {
        $text = implode('. ', array_filter([
            $group['name'] ?? '', $group['description'] ?? '',
        ]));
        $this->store((int) $group['tenant_id'], 'group', (int) $group['id'], $text);
    }

    public function generateForJob(array $job): void
    {
        $text = implode('. ', array_filter([
            $job['title'] ?? '', $job['tagline'] ?? '', $job['description'] ?? '',
            $job['location'] ?? '', $job['skills_required'] ?? '',
        ]));
        $this->store((int) $job['tenant_id'], 'job', (int) $job['id'], $text);
    }

    public function generateForMarketplace(array $item): void
    {
        $text = implode('. ', array_filter([
            $item['title'] ?? '', $item['tagline'] ?? '', $item['description'] ?? '',
            $item['condition'] ?? '', $item['location'] ?? '',
        ]));
        $this->store((int) $item['tenant_id'], 'marketplace', (int) $item['id'], $text);
    }

    public function generateForCourse(array $course): void
    {
        $text = implode('. ', array_filter([
            $course['title'] ?? '', $course['summary'] ?? '', $course['description'] ?? '',
        ]));
        $this->store((int) $course['tenant_id'], 'course', (int) $course['id'], $text);
    }

    public function generateForKbArticle(array $article): void
    {
        $body = trim(preg_replace('/\s+/u', ' ', html_entity_decode(strip_tags((string) ($article['content'] ?? '')))) ?? '');
        $text = trim(($article['title'] ?? '') . '. ' . mb_substr($body, 0, 6000));
        $this->store((int) $article['tenant_id'], 'kb_article', (int) $article['id'], $text);
    }

    /**
     * Dispatcher used by the queued ReindexEmbeddingJob — picks the right
     * type-specific generator based on a string type key.
     */
    public function generateFor(string $contentType, array $row): void
    {
        match ($contentType) {
            'listing' => $this->generateForListing($row),
            'user' => $this->generateForUser($row),
            'event' => $this->generateForEvent($row),
            'group' => $this->generateForGroup($row),
            'job' => $this->generateForJob($row),
            'marketplace' => $this->generateForMarketplace($row),
            'course' => $this->generateForCourse($row),
            'kb_article' => $this->generateForKbArticle($row),
            default => null,
        };
    }

    /**
     * Delete the stored embedding for a piece of content (call on model delete).
     */
    public function delete(int $tenantId, string $contentType, int $contentId): void
    {
        try {
            DB::table('content_embeddings')
                ->where('tenant_id', $tenantId)
                ->where('content_type', $contentType)
                ->where('content_id', $contentId)
                ->delete();
        } catch (\Throwable $e) {
            Log::info("EmbeddingService::delete failed: " . $e->getMessage());
        }
    }

    // =========================================================================
    // SEMANTIC QUERY
    // =========================================================================

    /**
     * Semantic search: embed the query, then rank stored embeddings by cosine
     * similarity. Tenant-scoped. Returns the top-K rows with content_type,
     * content_id, and a score in [0,1].
     *
     * Cost guard: caller can pass a candidate cap (default 2000) to bound the
     * in-memory cosine pass. For very large tenants we'd want a real vector
     * index, but cap + index on (tenant_id, content_type) keeps this O(N) PHP
     * loop tolerable up to ~5k embeddings per tenant.
     *
     * @param string[] $contentTypes restrict to these types; empty = all
     * @return array<int, array{content_type:string, content_id:int, score:float}>
     */
    public function semanticSearch(
        string $query,
        int $tenantId,
        array $contentTypes = [],
        int $limit = 10,
        int $candidateCap = 2000
    ): array {
        $query = trim($query);
        if ($query === '') {
            return [];
        }

        try {
            $apiKey = DB::table('ai_settings')
                ->where('tenant_id', $tenantId)
                ->where('setting_key', 'openai_api_key')
                ->value('setting_value');
            if (empty($apiKey)) {
                return [];
            }

            $queryVec = $this->callOpenAiEmbedding($apiKey, $query);
            if (!is_array($queryVec) || $queryVec === []) {
                return [];
            }

            $rowsQuery = DB::table('content_embeddings')
                ->where('tenant_id', $tenantId);
            if ($contentTypes !== []) {
                $rowsQuery->whereIn('content_type', $contentTypes);
            }
            $rows = $rowsQuery
                ->orderByDesc('updated_at')
                ->limit($candidateCap)
                ->get(['content_type', 'content_id', 'embedding']);

            $scored = [];
            foreach ($rows as $row) {
                $vec = json_decode($row->embedding, true);
                if (!is_array($vec) || $vec === []) {
                    continue;
                }
                $sim = $this->cosineSimilarity($queryVec, $vec);
                if ($sim <= 0.15) {
                    continue;
                }
                $scored[] = [
                    'content_type' => (string) $row->content_type,
                    'content_id' => (int) $row->content_id,
                    'score' => (float) $sim,
                ];
            }

            usort($scored, fn ($a, $b) => $b['score'] <=> $a['score']);
            return array_slice($scored, 0, $limit);
        } catch (\Throwable $e) {
            Log::warning('EmbeddingService::semanticSearch failed: ' . $e->getMessage());
            return [];
        }
    }

    // =========================================================================
    // FIND SIMILAR
    // =========================================================================

    /**
     * Find content IDs most semantically similar to the given item.
     *
     * @param int    $contentId   ID of the source item
     * @param string $contentType 'listing' | 'user' | 'event' | 'group'
     * @param int    $tenantId    Tenant scope
     * @param int    $limit       Max results
     * @return int[]              Similar content IDs (most similar first)
     */
    public function findSimilar(int $contentId, string $contentType, int $tenantId, int $limit = 5): array
    {
        try {
            $sourceRow = DB::table('content_embeddings')
                ->where('tenant_id', $tenantId)
                ->where('content_type', $contentType)
                ->where('content_id', $contentId)
                ->first();

            if (!$sourceRow || empty($sourceRow->embedding)) {
                return [];
            }

            $sourceVec = json_decode($sourceRow->embedding, true);
            if (!is_array($sourceVec) || empty($sourceVec)) {
                return [];
            }

            // PERF: Cap candidate set to most-recent N embeddings to bound latency.
            // Cosine similarity is computed in PHP (O(N*dim)) — for tenants with thousands
            // of embeddings, scanning the entire table per call is too slow.
            // Trade-off: reduced recall for bounded latency.
            // TODO: Migrate to a true vector DB (pgvector / Meilisearch hybrid / Qdrant)
            //       to push similarity scoring into the storage engine.
            $candidateLimit = 500;
            $rows = DB::table('content_embeddings')
                ->where('tenant_id', $tenantId)
                ->where('content_type', $contentType)
                ->where('content_id', '!=', $contentId)
                ->orderByDesc('updated_at')
                ->limit($candidateLimit)
                ->get();

            $similarities = [];
            foreach ($rows as $row) {
                $vec = json_decode($row->embedding, true);
                if (!is_array($vec) || empty($vec)) {
                    continue;
                }
                $sim = $this->cosineSimilarity($sourceVec, $vec);
                if ($sim > 0.0) {
                    $similarities[(int) $row->content_id] = $sim;
                }
            }

            arsort($similarities);

            return array_keys(array_slice($similarities, 0, $limit, true));
        } catch (\Exception $e) {
            Log::error('EmbeddingService::findSimilar error: ' . $e->getMessage());
            return [];
        }
    }

    /**
     * Like findSimilar(), but returns the cosine scores — the matching
     * engine's semantic SIGNAL needs per-candidate similarity values, not
     * just a boolean membership set.
     *
     * @return array<int, float> content_id => cosine similarity (desc)
     */
    public function findSimilarWithScores(int $contentId, string $contentType, int $tenantId, int $limit = 100): array
    {
        try {
            $sourceRow = DB::table('content_embeddings')
                ->where('tenant_id', $tenantId)
                ->where('content_type', $contentType)
                ->where('content_id', $contentId)
                ->first();

            if (!$sourceRow || empty($sourceRow->embedding)) {
                return [];
            }

            $sourceVec = json_decode($sourceRow->embedding, true);
            if (!is_array($sourceVec) || empty($sourceVec)) {
                return [];
            }

            $rows = DB::table('content_embeddings')
                ->where('tenant_id', $tenantId)
                ->where('content_type', $contentType)
                ->where('content_id', '!=', $contentId)
                ->orderByDesc('updated_at')
                ->limit(500)
                ->get();

            $similarities = [];
            foreach ($rows as $row) {
                $vec = json_decode($row->embedding, true);
                if (!is_array($vec) || empty($vec)) {
                    continue;
                }
                $sim = $this->cosineSimilarity($sourceVec, $vec);
                if ($sim > 0.0) {
                    $similarities[(int) $row->content_id] = (float) $sim;
                }
            }

            arsort($similarities);

            return array_slice($similarities, 0, $limit, true);
        } catch (\Exception $e) {
            Log::error('EmbeddingService::findSimilarWithScores error: ' . $e->getMessage());
            return [];
        }
    }

    // =========================================================================
    // CORE MATH
    // =========================================================================

    /**
     * Cosine similarity between two dense vectors.
     *
     * cos(A, B) = (A . B) / (|A| x |B|)
     *
     * @param float[] $a
     * @param float[] $b
     * @return float Similarity in [-1, 1]
     */
    public function cosineSimilarity(array $a, array $b): float
    {
        if (count($a) !== count($b)) {
            Log::debug('EmbeddingService::cosineSimilarity dimension mismatch: ' . count($a) . ' vs ' . count($b));
        }

        $dot = 0.0;
        $normA = 0.0;
        $normB = 0.0;

        $len = min(count($a), count($b));
        for ($i = 0; $i < $len; $i++) {
            $dot += $a[$i] * $b[$i];
            $normA += $a[$i] * $a[$i];
            $normB += $b[$i] * $b[$i];
        }

        $denom = sqrt($normA) * sqrt($normB);

        if ($denom <= 0.0) {
            return 0.0;
        }
        $result = $dot / $denom;
        return (is_nan($result) || is_infinite($result)) ? 0.0 : (float) max(-1.0, min(1.0, $result));
    }

    // =========================================================================
    // INTERNAL HELPERS
    // =========================================================================

    private function listingToText(array $listing): string
    {
        $parts = array_filter([
            $listing['title'] ?? '',
            $listing['description'] ?? '',
            $listing['location'] ?? '',
            $listing['skills'] ?? '',
        ]);

        return implode('. ', $parts);
    }

    private function userToText(array $user): string
    {
        $name = UserDisplayName::resolve($user);
        $parts = array_filter([$name, $user['bio'] ?? '', $user['skills'] ?? '']);

        return implode('. ', $parts);
    }

    /**
     * Generate an embedding via OpenAI and store it in content_embeddings.
     */
    private function store(int $tenantId, string $contentType, int $contentId, string $text): void
    {
        $text = trim($text);
        if ($text === '') {
            return;
        }

        try {
            $apiKey = DB::table('ai_settings')
                ->where('tenant_id', $tenantId)
                ->where('setting_key', 'openai_api_key')
                ->value('setting_value');

            if (empty($apiKey)) {
                return;
            }

            // Call OpenAI embeddings API directly
            $response = $this->callOpenAiEmbedding($apiKey, $text);
            if (empty($response)) {
                return;
            }

            DB::statement(
                "INSERT INTO content_embeddings (tenant_id, content_type, content_id, model, embedding)
                 VALUES (?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE model = VALUES(model), embedding = VALUES(embedding), updated_at = NOW()",
                [$tenantId, $contentType, $contentId, self::MODEL, json_encode($response)]
            );
        } catch (\Throwable $e) {
            Log::info("EmbeddingService: failed to store {$contentType}#{$contentId}: " . $e->getMessage());
        }
    }

    /**
     * Call OpenAI embedding API.
     *
     * @return float[]|null
     */
    private function callOpenAiEmbedding(string $apiKey, string $text): ?array
    {
        try {
            $ch = curl_init('https://api.openai.com/v1/embeddings');
            curl_setopt_array($ch, [
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_POST => true,
                CURLOPT_HTTPHEADER => [
                    'Content-Type: application/json',
                    'Authorization: Bearer ' . $apiKey,
                ],
                CURLOPT_POSTFIELDS => json_encode([
                    'input' => $text,
                    'model' => self::MODEL,
                ]),
                CURLOPT_TIMEOUT => 30,
            ]);

            $response = curl_exec($ch);
            $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
            curl_close($ch);

            if ($httpCode !== 200 || !$response) {
                return null;
            }

            $data = json_decode($response, true);
            return $data['data'][0]['embedding'] ?? null;
        } catch (\Throwable $e) {
            Log::debug('[EmbeddingService] generateEmbedding failed: ' . $e->getMessage());
            return null;
        }
    }
}
