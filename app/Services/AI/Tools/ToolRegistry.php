<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services\AI\Tools;

use Illuminate\Support\Facades\Log;

/**
 * Registry of AI chat tools.
 *
 * Built once per request and injected into AiChatController. Adding a new
 * tool means: implement ToolInterface, register it here in `defaultTools()`.
 */
class ToolRegistry
{
    /** @var array<string, ToolInterface> */
    private array $tools = [];

    public function __construct()
    {
        foreach ($this->defaultTools() as $tool) {
            $this->register($tool);
        }
    }

    public function register(ToolInterface $tool): void
    {
        $this->tools[$tool->name()] = $tool;
    }

    /** @return ToolInterface[] */
    public function all(): array
    {
        return array_values($this->tools);
    }

    /** @return ToolInterface[] */
    public function availableFor(int $userId): array
    {
        return array_values(array_filter(
            $this->tools,
            fn (ToolInterface $t) => $t->isAvailable($userId)
        ));
    }

    /**
     * OpenAI-style tool schemas for the tools available to this user.
     * @return array<int, array<string, mixed>>
     */
    public function openAiSchemasFor(int $userId): array
    {
        $out = [];
        foreach ($this->availableFor($userId) as $tool) {
            if ($tool instanceof AbstractTool) {
                $out[] = $tool->toOpenAiFunction();
            } else {
                $out[] = [
                    'type' => 'function',
                    'function' => [
                        'name' => $tool->name(),
                        'description' => $tool->description(),
                        'parameters' => $tool->parametersSchema(),
                    ],
                ];
            }
        }
        return $out;
    }

    /**
     * Execute a tool by name with caller-supplied arguments. Errors are
     * caught and returned as a structured `err` envelope so the model can
     * recover gracefully.
     */
    public function execute(
        string $name,
        array $arguments,
        int $userId,
        ?callable $beforeAiProviderCall = null,
    ): array
    {
        $tool = $this->tools[$name] ?? null;
        if (!$tool) {
            return [
                'ok' => false,
                'summary' => 'Unknown tool: ' . $name,
                'results' => [],
                'card_type' => 'error',
                'error' => 'unknown_tool',
            ];
        }
        if (!$tool->isAvailable($userId)) {
            return [
                'ok' => false,
                'summary' => 'Tool not available for this user',
                'results' => [],
                'card_type' => 'error',
                'error' => 'not_available',
            ];
        }
        try {
            if ($tool instanceof SemanticSearchTool && $beforeAiProviderCall !== null) {
                return $tool->executeWithAdmission($arguments, $userId, $beforeAiProviderCall);
            }
            return $tool->execute($arguments, $userId);
        } catch (\App\Exceptions\AiBudgetExceededException $e) {
            throw $e;
        } catch (\Throwable $e) {
            Log::warning('AI tool execution failed', [
                'tool' => $name,
                'error' => $e->getMessage(),
                'user_id' => $userId,
            ]);
            return [
                'ok' => false,
                'summary' => 'Tool failed: ' . $e->getMessage(),
                'results' => [],
                'card_type' => 'error',
                'error' => 'execution_failed',
            ];
        }
    }

    /**
     * Default tool set. Order does not affect model behaviour.
     *
     * @return ToolInterface[]
     */
    private function defaultTools(): array
    {
        return [
            new SearchListingsTool(),
            new SearchMembersTool(),
            new SearchKbTool(),
            new SearchEventsTool(),
            new SearchJobsTool(),
            new SearchMarketplaceTool(),
            new GetMyWalletBalanceTool(),
            new SemanticSearchTool(),
        ];
    }
}
