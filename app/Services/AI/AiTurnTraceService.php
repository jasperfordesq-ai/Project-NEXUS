<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services\AI;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Persists one row per AI chat turn for cost/quality monitoring.
 *
 * Cost computation is best-effort and based on a static pricing map below.
 * Update when model prices change (or move pricing to config if it churns).
 */
class AiTurnTraceService
{
    /**
     * USD per 1k tokens. Input/output broken out where the provider charges
     * them differently. Keep small — only the models we actually use.
     */
    private const PRICING = [
        // OpenAI
        'gpt-4o-mini' => ['in' => 0.00015, 'out' => 0.0006],
        'gpt-4o' => ['in' => 0.0025, 'out' => 0.010],
        'gpt-4-turbo' => ['in' => 0.010, 'out' => 0.030],
        // Anthropic
        'claude-3-5-sonnet-20241022' => ['in' => 0.003, 'out' => 0.015],
        'claude-sonnet-4-6' => ['in' => 0.003, 'out' => 0.015],
        'claude-haiku-4-5-20251001' => ['in' => 0.0008, 'out' => 0.004],
        // Gemini (rough)
        'gemini-1.5-flash' => ['in' => 0.000075, 'out' => 0.0003],
        'gemini-1.5-pro' => ['in' => 0.00125, 'out' => 0.005],
    ];

    public function record(array $row): int
    {
        try {
            $tokensIn = (int) ($row['tokens_input'] ?? 0);
            $tokensOut = (int) ($row['tokens_output'] ?? 0);
            $tokensTotal = (int) ($row['tokens_total'] ?? ($tokensIn + $tokensOut));
            $cost = $this->estimateCost((string) ($row['model'] ?? ''), $tokensIn, $tokensOut);

            return (int) DB::table('ai_turn_traces')->insertGetId([
                'tenant_id' => (int) ($row['tenant_id'] ?? 0),
                'user_id' => (int) ($row['user_id'] ?? 0),
                'conversation_id' => isset($row['conversation_id']) ? (int) $row['conversation_id'] : null,
                'message_id' => isset($row['message_id']) ? (int) $row['message_id'] : null,
                'user_text' => mb_substr((string) ($row['user_text'] ?? ''), 0, 4000),
                'assistant_text' => mb_substr((string) ($row['assistant_text'] ?? ''), 0, 8000),
                'provider' => $row['provider'] ?? null,
                'model' => $row['model'] ?? null,
                'tokens_input' => $tokensIn ?: null,
                'tokens_output' => $tokensOut ?: null,
                'tokens_total' => $tokensTotal ?: null,
                'cost_usd' => $cost,
                'latency_ms' => isset($row['latency_ms']) ? (int) $row['latency_ms'] : null,
                'tool_calls' => isset($row['tool_calls']) ? json_encode($this->compactTools($row['tool_calls'])) : null,
                'error' => isset($row['error']) ? mb_substr((string) $row['error'], 0, 255) : null,
            ]);
        } catch (\Throwable $e) {
            Log::info('AiTurnTraceService::record failed: ' . $e->getMessage());
            return 0;
        }
    }

    public function recordFeedback(int $traceId, int $tenantId, int $userId, string $feedback, ?string $note = null): bool
    {
        if (!in_array($feedback, ['up', 'down'], true)) {
            return false;
        }
        return DB::table('ai_turn_traces')
            ->where('id', $traceId)
            ->where('tenant_id', $tenantId)
            ->where('user_id', $userId)
            ->update([
                'feedback' => $feedback,
                'feedback_note' => $note ? mb_substr($note, 0, 500) : null,
                'feedback_at' => now(),
            ]) > 0;
    }

    public function recordFeedbackByMessage(int $messageId, int $tenantId, int $userId, string $feedback, ?string $note = null): bool
    {
        if (!in_array($feedback, ['up', 'down'], true)) {
            return false;
        }
        return DB::table('ai_turn_traces')
            ->where('message_id', $messageId)
            ->where('tenant_id', $tenantId)
            ->where('user_id', $userId)
            ->update([
                'feedback' => $feedback,
                'feedback_note' => $note ? mb_substr($note, 0, 500) : null,
                'feedback_at' => now(),
            ]) > 0;
    }

    /**
     * Aggregate metrics for the admin dashboard. Restricted to the last N
     * days to keep the query cheap.
     *
     * @return array<string, mixed>
     */
    public function metricsFor(int $tenantId, int $days = 30): array
    {
        $since = now()->subDays($days);

        $totals = DB::table('ai_turn_traces')
            ->where('tenant_id', $tenantId)
            ->where('created_at', '>=', $since)
            ->selectRaw('COUNT(*) as turns, SUM(tokens_total) as tokens, SUM(cost_usd) as cost, AVG(latency_ms) as avg_latency, SUM(CASE WHEN feedback = "up" THEN 1 ELSE 0 END) as ups, SUM(CASE WHEN feedback = "down" THEN 1 ELSE 0 END) as downs')
            ->first();

        $topTools = $this->topTools($tenantId, $since);
        $unanswered = $this->recentDownvotes($tenantId, $since, 20);

        return [
            'window_days' => $days,
            'turns' => (int) ($totals->turns ?? 0),
            'tokens_total' => (int) ($totals->tokens ?? 0),
            'cost_usd' => (float) ($totals->cost ?? 0.0),
            'avg_latency_ms' => (int) round($totals->avg_latency ?? 0),
            'thumbs_up' => (int) ($totals->ups ?? 0),
            'thumbs_down' => (int) ($totals->downs ?? 0),
            'top_tools' => $topTools,
            'unanswered' => $unanswered,
        ];
    }

    private function estimateCost(string $model, int $tokensIn, int $tokensOut): ?float
    {
        $price = self::PRICING[$model] ?? null;
        if (!$price) {
            return null;
        }
        return round(($tokensIn / 1000.0) * $price['in'] + ($tokensOut / 1000.0) * $price['out'], 6);
    }

    /**
     * Strip per-call result bodies; keep only tool name, ok, summary.
     * Avoids blowing up the JSON column with full search results.
     */
    private function compactTools(array $toolInvocations): array
    {
        $out = [];
        foreach ($toolInvocations as $inv) {
            $out[] = [
                'name' => $inv['name'] ?? '',
                'ok' => (bool) ($inv['ok'] ?? false),
                'result_count' => is_array($inv['results'] ?? null) ? count($inv['results']) : 0,
                'summary' => mb_substr((string) ($inv['summary'] ?? ''), 0, 160),
            ];
        }
        return $out;
    }

    /** @return array<int, array<string, mixed>> */
    private function topTools(int $tenantId, $since): array
    {
        // tool_calls JSON contains an array per row. We can't easily aggregate
        // inside JSON in portable SQL across MySQL/MariaDB versions, so do a
        // small in-PHP roll-up over the most recent N rows.
        $rows = DB::table('ai_turn_traces')
            ->where('tenant_id', $tenantId)
            ->where('created_at', '>=', $since)
            ->whereNotNull('tool_calls')
            ->orderByDesc('created_at')
            ->limit(2000)
            ->pluck('tool_calls');

        $counts = [];
        foreach ($rows as $json) {
            $decoded = json_decode((string) $json, true);
            if (!is_array($decoded)) {
                continue;
            }
            foreach ($decoded as $inv) {
                $name = $inv['name'] ?? '';
                if ($name === '') continue;
                $counts[$name] = ($counts[$name] ?? 0) + 1;
            }
        }
        arsort($counts);
        $out = [];
        foreach (array_slice($counts, 0, 10, true) as $name => $count) {
            $out[] = ['name' => $name, 'calls' => $count];
        }
        return $out;
    }

    /** @return array<int, array<string, mixed>> */
    private function recentDownvotes(int $tenantId, $since, int $limit): array
    {
        return DB::table('ai_turn_traces')
            ->where('tenant_id', $tenantId)
            ->where('feedback', 'down')
            ->where('created_at', '>=', $since)
            ->orderByDesc('feedback_at')
            ->limit($limit)
            ->get(['id', 'user_text', 'assistant_text', 'feedback_note', 'feedback_at', 'model'])
            ->map(fn ($r) => [
                'id' => (int) $r->id,
                'user_text' => mb_substr((string) $r->user_text, 0, 300),
                'assistant_text' => mb_substr((string) $r->assistant_text, 0, 400),
                'note' => $r->feedback_note,
                'at' => $r->feedback_at,
                'model' => $r->model,
            ])
            ->all();
    }
}
