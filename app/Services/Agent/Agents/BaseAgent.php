<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services\Agent\Agents;

use App\Services\AI\AIServiceFactory;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * AG61 — KI-Agenten BaseAgent.
 *
 * Concrete agent classes extend this and implement `run()`. Provides shared
 * proposal-creation, LLM-call, and token-tracking helpers.
 */
abstract class BaseAgent
{
    protected int $tenantId;
    protected int $runId;
    protected int $definitionId;
    /** @var array<string,mixed> */
    protected array $config;

    /** Token accumulators populated by callLlm(). */
    protected int $totalInputTokens = 0;
    protected int $totalOutputTokens = 0;

    /**
     * @param array<string,mixed> $config
     */
    public function __construct(int $tenantId, int $runId, int $definitionId, array $config = [])
    {
        $this->tenantId     = $tenantId;
        $this->runId        = $runId;
        $this->definitionId = $definitionId;
        $this->config       = $config;
    }

    /**
     * Run the agent. Returns a result array with at minimum:
     *   - proposals_created: int
     *   - summary: string
     *   - llm_input_tokens: int
     *   - llm_output_tokens: int
     *   - cost_cents: int
     *
     * @return array<string,mixed>
     */
    abstract public function run(): array;

    /**
     * Persist a proposal row tied to this run.
     *
     * @param array<string,mixed> $data
     */
    protected function createProposal(
        string $type,
        array $data,
        string $reasoning = '',
        float $confidence = 0.5,
        ?int $subjectUserId = null,
        ?int $targetUserId = null,
        int $expiresInDays = 7,
    ): int {
        $row = [
            'tenant_id'           => $this->tenantId,
            'run_id'              => $this->runId,
            'agent_definition_id' => $this->definitionId,
            'proposal_type'       => $type,
            'subject_user_id'     => $subjectUserId,
            'target_user_id'      => $targetUserId,
            'proposal_data'       => json_encode($data),
            'reasoning'           => $reasoning ?: null,
            'status'              => 'pending_review',
            'confidence_score'    => round(max(0.0, min(1.0, $confidence)), 4),
            'expires_at'          => now()->addDays($expiresInDays),
            'created_at'          => now(),
            'updated_at'          => now(),
        ];

        return DB::table('agent_proposals')->insertGetId($row);
    }

    /**
     * Call the community's chosen AI provider and saved model (admin AI
     * settings page). Tracks tokens.
     *
     * Returns ['content' => string, 'input_tokens' => int, 'output_tokens' => int].
     * While the community's AI is off, or the call fails, returns
     * ['content' => '', 'input_tokens' => 0, 'output_tokens' => 0] — agents
     * should fall back to deterministic copy.
     *
     * @param list<array{role:string,content:string}> $messages
     * @return array{content:string,input_tokens:int,output_tokens:int}
     */
    protected function callLlm(array $messages, array $options = []): array
    {
        // F-633: the community's own AI switch, provider and saved model — not
        // the platform environment's OpenAI key and a fixed OpenAI model.
        if (!AIServiceFactory::isEnabledForTenant($this->tenantId)) {
            return ['content' => '', 'input_tokens' => 0, 'output_tokens' => 0];
        }

        $opts = array_merge([
            'temperature' => 0.3,
            'max_tokens'  => 600,
        ], $options);

        try {
            $response = AIServiceFactory::chatWithFallback($messages, $opts);
            $in  = (int) ($response['tokens_input'] ?? 0);
            $out = (int) ($response['tokens_output'] ?? 0);

            $this->totalInputTokens  += $in;
            $this->totalOutputTokens += $out;

            return [
                'content'       => (string) ($response['content'] ?? ''),
                'input_tokens'  => $in,
                'output_tokens' => $out,
            ];
        } catch (\Throwable $e) {
            Log::warning('AG61 LLM call failed: ' . $e->getMessage());
            return ['content' => '', 'input_tokens' => 0, 'output_tokens' => 0];
        }
    }

    /**
     * Estimate cost in cents for gpt-4o-mini (US$0.15/1M input, US$0.60/1M output)
     * — billed in cents and rounded up to a whole cent.
     */
    protected function estimateCostCents(int $inputTokens, int $outputTokens): int
    {
        $inUsd  = ($inputTokens  / 1_000_000) * 0.15;
        $outUsd = ($outputTokens / 1_000_000) * 0.60;
        return (int) ceil(($inUsd + $outUsd) * 100);
    }
}
