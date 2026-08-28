<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use App\Core\TenantContext;
use App\Models\AiConversation;
use App\Models\AiMessage;
use App\Models\AiUsage;
use App\Models\AiUserLimit;
use App\Models\Event;
use App\Models\Listing;
use App\Models\User;
use App\Services\AI\AIServiceFactory;
use App\Services\AI\AiModuleDocsService;
use App\Services\AI\AiTurnTraceService;
use App\Services\AI\AiUserMemoryService;
use App\Services\AI\Tools\ToolRegistry;
use App\Services\AiSupportContextService;

/**
 * AiChatController -- AI chat endpoints (chat, stream, history, conversations,
 * providers, content generation).
 *
 * Core chat/history uses DB facade. Conversation CRUD uses legacy models.
 * Content generation methods call AIServiceFactory directly with prompt building
 * inlined from the former legacy AI controllers.
 */
class AiChatController extends BaseApiController
{
    protected bool $isV2Api = true;

    /** Max round-trips the model can take through tool calls before we cut it off. */
    private const MAX_TOOL_HOPS = 5;

    public function __construct(
        private readonly AIServiceFactory $aiServiceFactory,
        private readonly AiSupportContextService $supportContextService,
        private readonly ToolRegistry $toolRegistry,
        private readonly AiModuleDocsService $moduleDocs,
        private readonly AiTurnTraceService $traces,
        private readonly AiUserMemoryService $userMemory,
    ) {}

    // =====================================================================
    // CHAT (already migrated)
    // =====================================================================

    /** POST /api/v2/ai/chat */
    public function chat(): JsonResponse
    {
        $userId = $this->requireAuth();
        $tenantId = $this->getTenantId();
        $this->rateLimit('ai_chat', 30, 60);

        $message = $this->requireInput('message');
        $conversationId = $this->input('conversation_id');

        // Create or find conversation
        if ($conversationId) {
            $conversation = DB::selectOne(
                'SELECT id FROM ai_conversations WHERE id = ? AND tenant_id = ? AND user_id = ?',
                [$conversationId, $tenantId, $userId]
            );
            if (!$conversation) {
                $conversationId = null;
            }
        }

        if (!$conversationId) {
            DB::insert(
                'INSERT INTO ai_conversations (tenant_id, user_id, title, created_at, updated_at) VALUES (?, ?, ?, NOW(), NOW())',
                [$tenantId, $userId, mb_substr($message, 0, 100)]
            );
            $conversationId = (int) DB::getPdo()->lastInsertId();
        }

        // Save user message
        DB::insert(
            'INSERT INTO ai_messages (conversation_id, role, content, created_at) VALUES (?, ?, ?, NOW())',
            [$conversationId, 'user', $message]
        );

        $supportContext = $this->supportContextService->build($userId, $message);

        // Build a bounded conversation history for context.
        $history = $this->supportContextService->recentConversationHistory((int) $conversationId);
        $toolGuidance = <<<TXT
You have retrieval tools available (search_listings, search_members, search_kb, search_events, search_jobs, search_marketplace, get_my_wallet_balance, semantic_search). Call them whenever the user's question would benefit from live, tenant-scoped data — for example, "find me a gardener", "what events are on this weekend", "who can teach me Spanish", "what is my balance". Prefer the specific keyword search_* tools first; fall back to semantic_search only when the question is vague, uses synonyms, or a keyword search returned nothing. Only call get_my_wallet_balance when the user is clearly asking about their own balance. After a tool returns, summarise the results conversationally and reference items by title; the UI will render structured cards beside your message, so do not paste raw URLs or repeat every field — keep your reply readable and concise.
TXT;
        $moduleDocsPrompt = $this->moduleDocs->renderForPrompt((int) $tenantId, $message);
        $userMemoryPrompt = $this->userMemory->buildPrompt((int) $tenantId, (int) $userId);

        $chatMessages = [
            ['role' => 'system', 'content' => AIServiceFactory::getSystemPrompt() ?: 'You are a helpful community assistant for a timebanking platform.'],
            ['role' => 'system', 'content' => $toolGuidance],
            ['role' => 'system', 'content' => $supportContext['content']],
        ];
        if ($userMemoryPrompt !== '') {
            $chatMessages[] = ['role' => 'system', 'content' => $userMemoryPrompt];
        }
        if ($moduleDocsPrompt !== '') {
            $chatMessages[] = ['role' => 'system', 'content' => $moduleDocsPrompt];
        }
        // Summarise long history to keep tokens bounded: if more than 20 prior
        // messages exist, condense everything older than the last 12 into a
        // short summary block produced by the model itself on a previous turn.
        // For now we just trim to the last 12 turns — summarisation is a
        // future enhancement.
        $bounded = count($history) > 12 ? array_slice($history, -12) : $history;
        foreach ($bounded as $row) {
            $chatMessages[] = ['role' => $row->role, 'content' => $row->content];
        }

        // Tool-augmented chat: model may call retrieval tools (search_listings,
        // search_members, etc.) to ground its answer in live tenant data. Each
        // hop replays the full message history plus tool results, up to
        // MAX_TOOL_HOPS, after which we force a final text answer.
        $tools = $this->toolRegistry->openAiSchemasFor((int) $userId);
        $toolInvocations = [];
        $content = null;
        $tokensUsed = 0;
        $tokensIn = 0;
        $tokensOut = 0;
        $model = null;
        $provider = null;
        $traceError = null;
        $startedAt = microtime(true);

        try {
            $hop = 0;
            while ($hop < self::MAX_TOOL_HOPS) {
                $response = AIServiceFactory::chatWithFallback($chatMessages, [
                    'temperature' => 0.2,
                    'max_tokens' => 1200,
                    'tools' => $tools,
                    'tool_choice' => 'auto',
                ]);

                $tokensUsed += (int) ($response['tokens_used'] ?? 0);
                $tokensIn += (int) ($response['tokens_input'] ?? 0);
                $tokensOut += (int) ($response['tokens_output'] ?? 0);
                $model = $response['model'] ?? $model;
                $provider = $response['provider'] ?? $provider;

                $toolCalls = $response['tool_calls'] ?? [];
                if ($toolCalls === []) {
                    $content = $response['content'] ?? '';
                    break;
                }

                $chatMessages[] = [
                    'role' => 'assistant',
                    'content' => $response['content'] ?? '',
                    'tool_calls' => $toolCalls,
                ];

                foreach ($toolCalls as $call) {
                    $result = $this->toolRegistry->execute(
                        (string) $call['name'],
                        is_array($call['arguments'] ?? null) ? $call['arguments'] : [],
                        (int) $userId
                    );
                    $toolInvocations[] = [
                        'name' => $call['name'] ?? '',
                        'arguments' => $call['arguments'] ?? [],
                        'ok' => (bool) ($result['ok'] ?? false),
                        'summary' => (string) ($result['summary'] ?? ''),
                        'card_type' => (string) ($result['card_type'] ?? 'generic'),
                        'results' => $result['results'] ?? [],
                    ];
                    $chatMessages[] = [
                        'role' => 'tool',
                        'tool_call_id' => $call['id'] ?? '',
                        'content' => json_encode([
                            'ok' => $result['ok'] ?? false,
                            'summary' => $result['summary'] ?? '',
                            'results' => $result['results'] ?? [],
                            'error' => $result['error'] ?? null,
                        ]),
                    ];
                }
                $hop++;
            }
            if ($content === null) {
                // Hit hop limit — make one final call with no tools to force a text answer.
                $response = AIServiceFactory::chatWithFallback($chatMessages, [
                    'temperature' => 0.2,
                    'max_tokens' => 1200,
                ]);
                $content = $response['content'] ?? '';
                $tokensUsed += (int) ($response['tokens_used'] ?? 0);
                $tokensIn += (int) ($response['tokens_input'] ?? 0);
                $tokensOut += (int) ($response['tokens_output'] ?? 0);
                $model = $response['model'] ?? $model;
                $provider = $response['provider'] ?? $provider;
            }
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::warning('AI chat provider failed', [
                'error' => $e->getMessage(),
                'tenant_id' => $tenantId,
            ]);
            $content = __('api_controllers_1.ai_chat.not_available');
            $traceError = $e->getMessage();
        }

        $latencyMs = (int) round((microtime(true) - $startedAt) * 1000);

        // Save assistant reply
        DB::insert(
            'INSERT INTO ai_messages (conversation_id, role, content, tokens_used, model, created_at) VALUES (?, ?, ?, ?, ?, NOW())',
            [$conversationId, 'assistant', $content, $tokensUsed, $model]
        );
        $messageId = (int) DB::getPdo()->lastInsertId();

        // Update conversation timestamp
        DB::update('UPDATE ai_conversations SET updated_at = NOW() WHERE id = ?', [$conversationId]);

        $traceId = $this->traces->record([
            'tenant_id' => (int) $tenantId,
            'user_id' => (int) $userId,
            'conversation_id' => (int) $conversationId,
            'message_id' => $messageId,
            'user_text' => $message,
            'assistant_text' => (string) $content,
            'provider' => $provider,
            'model' => $model,
            'tokens_input' => $tokensIn,
            'tokens_output' => $tokensOut,
            'tokens_total' => $tokensUsed,
            'latency_ms' => $latencyMs,
            'tool_calls' => $toolInvocations,
            'error' => $traceError,
        ]);

        return $this->respondWithData([
            'success' => true,
            'conversation_id' => $conversationId,
            'message' => [
                'id' => $messageId,
                'role' => 'assistant',
                'content' => $content,
            ],
            'tokens_used' => $tokensUsed,
            'model' => $model,
            'provider' => $provider,
            'trace_id' => $traceId ?: null,
            'sources' => $supportContext['sources'],
            'source_count' => $supportContext['source_count'],
            'tool_invocations' => $toolInvocations,
        ]);
    }

    /** GET /api/v2/ai/chat/starters — tenant-tailored empty-state prompts */
    public function starters(): JsonResponse
    {
        $this->requireAuth();
        $service = app(\App\Services\AI\AiSuggestedPromptsService::class);
        return $this->respondWithData(['starters' => $service->pick(5)]);
    }

    /** POST /api/v2/ai/chat/feedback — thumbs up/down on the assistant turn */
    public function feedback(): JsonResponse
    {
        $userId = $this->requireAuth();
        $tenantId = $this->getTenantId();
        $this->rateLimit('ai_chat_feedback', 60, 60);

        $vote = (string) $this->requireInput('feedback');
        if (!in_array($vote, ['up', 'down'], true)) {
            return $this->respondWithError('VALIDATION', 'feedback must be "up" or "down"', null, 422);
        }
        $note = $this->input('note');
        $messageId = $this->inputInt('message_id');
        $traceId = $this->inputInt('trace_id');

        if ($traceId) {
            $ok = $this->traces->recordFeedback($traceId, (int) $tenantId, $vote, is_string($note) ? $note : null);
        } elseif ($messageId) {
            $ok = $this->traces->recordFeedbackByMessage($messageId, (int) $tenantId, $vote, is_string($note) ? $note : null);
        } else {
            return $this->respondWithError('VALIDATION', 'Either trace_id or message_id is required', null, 422);
        }

        if (!$ok) {
            return $this->respondWithError('NOT_FOUND', 'No matching trace to update', null, 404);
        }
        return $this->respondWithData(['recorded' => true, 'feedback' => $vote, 'user_id' => $userId]);
    }

    /** POST /api/v2/ai/chat/stream — SSE streaming, kept as delegation */
    public function streamChat(): JsonResponse
    {
        $this->requireAuth();
        $this->rateLimit('ai_chat_stream', 20, 60);

        return $this->respondWithError(
            'NOT_IMPLEMENTED',
            __('api.ai_streaming_not_available'),
            null,
            501
        );
    }

    // =====================================================================
    // HISTORY (already migrated)
    // =====================================================================

    /** GET /api/v2/ai/chat/history */
    public function history(): JsonResponse
    {
        $userId = $this->requireAuth();
        $tenantId = $this->getTenantId();
        $page = $this->queryInt('page', 1, 1);
        $perPage = $this->queryInt('per_page', 20, 1, 50);
        $offset = ($page - 1) * $perPage;

        $items = DB::select(
            'SELECT m.* FROM ai_messages m
             INNER JOIN ai_conversations c ON c.id = m.conversation_id
             WHERE c.tenant_id = ? AND c.user_id = ?
             ORDER BY m.created_at DESC LIMIT ? OFFSET ?',
            [$tenantId, $userId, $perPage, $offset]
        );
        $total = (int) DB::selectOne(
            'SELECT COUNT(*) as cnt FROM ai_messages m
             INNER JOIN ai_conversations c ON c.id = m.conversation_id
             WHERE c.tenant_id = ? AND c.user_id = ?',
            [$tenantId, $userId]
        )->cnt;

        return $this->respondWithPaginatedCollection($items, $total, $page, $perPage);
    }

    // =====================================================================
    // CONVERSATIONS
    // =====================================================================

    /** GET /api/v2/ai/conversations */
    public function listConversations(): JsonResponse
    {
        $userId = $this->getUserId();
        $limit = min($this->queryInt('limit', 50, 1, 100), 100);
        $offset = $this->queryInt('offset', 0, 0);

        $conversations = AiConversation::getByUserId($userId, $this->getTenantId());
        $total = AiConversation::countByUserId($userId, $this->getTenantId());

        return $this->respondWithData($conversations, [
            'total' => $total,
            'limit' => $limit,
            'offset' => $offset,
        ]);
    }

    /** GET /api/v2/ai/conversations/{id} */
    public function getConversation($id): JsonResponse
    {
        $userId = $this->getUserId();
        $id = (int) $id;

        if (!AiConversation::belongsToUser($id, $userId)) {
            return $this->respondWithError('RESOURCE_NOT_FOUND', __('api.ai_conversation_not_found'), null, 404);
        }

        $conversation = AiConversation::getWithMessages($id);

        return $this->respondWithData($conversation);
    }

    /** POST /api/v2/ai/conversations */
    public function createConversation(): JsonResponse
    {
        $userId = $this->getUserId();

        // tenant_id is auto-set by HasTenantScope on create.
        $conversationId = AiConversation::create([
            'user_id' => $userId,
            'title' => $this->input('title', 'New Chat'),
            'provider' => $this->input('provider'),
            'context_type' => $this->input('context_type', 'general'),
            'context_id' => $this->input('context_id'),
        ])->id;

        return $this->respondWithData([
            'conversation_id' => $conversationId,
        ], null, 201);
    }

    /** DELETE /api/v2/ai/conversations/{id} */
    public function deleteConversation($id): JsonResponse
    {
        $userId = $this->getUserId();
        $id = (int) $id;

        if (!AiConversation::belongsToUser($id, $userId)) {
            return $this->respondWithError('RESOURCE_NOT_FOUND', __('api.ai_conversation_not_found'), null, 404);
        }

        AiConversation::where('id', $id)->delete();

        return $this->respondWithData(['success' => true]);
    }

    // =====================================================================
    // PROVIDERS
    // =====================================================================

    /** GET /api/v2/ai/providers */
    public function getProviders(): JsonResponse
    {
        $this->getUserId();

        $providers = $this->aiServiceFactory->getAvailableProviders();
        $defaultProvider = $this->aiServiceFactory->getDefaultProvider();

        return $this->respondWithData([
            'providers' => $providers,
            'default' => $defaultProvider,
            'enabled' => $this->aiServiceFactory->isEnabled(),
        ]);
    }

    /** GET /api/v2/ai/limits */
    public function getLimits(): JsonResponse
    {
        $userId = $this->getUserId();
        $limits = AiUserLimit::canMakeRequest($userId, $this->getTenantId());

        return $this->respondWithData(['limits' => $limits]);
    }

    /** POST /api/v2/ai/test-provider */
    public function testProvider(): JsonResponse
    {
        // Admin-only: exposes which AI providers are configured and each call
        // spends real provider API credit, so members must not reach it.
        $this->requireAdmin();

        $providerId = $this->input('provider', 'gemini');

        try {
            $provider = $this->aiServiceFactory->getProvider($providerId);
            $result = $provider->testConnection();

            return $this->respondWithData([
                'success' => $result['success'],
                'message' => $result['message'],
                'latency_ms' => $result['latency_ms'],
            ]);
        } catch (\Exception $e) {
            \Illuminate\Support\Facades\Log::warning('AI provider test failed', ['provider' => $providerId, 'error' => $e->getMessage()]);
            return $this->respondWithData([
                'success' => false,
                'message' => __('api_controllers_1.ai_chat.connection_test_failed'),
            ]);
        }
    }

    // =====================================================================
    // CONTENT GENERATION — User-facing
    // =====================================================================

    /** POST /api/v2/ai/generate/listing */
    public function generateListing(): JsonResponse
    {
        $userId = $this->requireAuth();

        if (!$this->aiServiceFactory->isFeatureEnabled('content_generation')) {
            return $this->respondWithError('FEATURE_DISABLED', __('api.ai_feature_disabled'), null, 403);
        }

        $limitCheck = AiUserLimit::canMakeRequest($userId);
        if (!$limitCheck['allowed']) {
            return $this->respondWithError('RATE_LIMIT', __('api.ai_rate_limit'), null, 429);
        }

        $title = trim($this->input('title', ''));
        $type = $this->input('type', 'offer');
        $context = $this->input('context', []);

        if (empty($title)) {
            return $this->respondWithError('VALIDATION_REQUIRED_FIELD', __('api.title_required'), 'title', 400);
        }

        try {
            $aiProvider = $this->aiServiceFactory->getProvider();
            $prompt = $this->buildListingPrompt($userId, $title, $type, $context);

            $messages = [
                ['role' => 'system', 'content' => $this->getContentGenerationSystemPrompt()],
                ['role' => 'user', 'content' => $prompt],
            ];

            $response = $aiProvider->chat($messages, ['temperature' => 0.7, 'max_tokens' => 800]);

            AiUserLimit::incrementUsage($userId);
            AiUsage::log($userId, $aiProvider->getId(), 'generate_listing', [
                'tokens_input' => $response['tokens_input'] ?? 0,
                'tokens_output' => $response['tokens_output'] ?? 0,
            ]);

            return $this->respondWithData([
                'success' => true,
                'content' => trim($response['content']),
            ]);
        } catch (\Exception $e) {
            \Illuminate\Support\Facades\Log::warning("AI generateListing error: " . $e->getMessage());
            return $this->respondWithError('AI_ERROR', $this->getFriendlyAiErrorMessage($e), null, 500);
        }
    }

    /** POST /api/v2/ai/generate/event */
    public function generateEvent(): JsonResponse
    {
        $userId = $this->requireAuth();

        if (!$this->aiServiceFactory->isFeatureEnabled('content_generation')) {
            return $this->respondWithError('FEATURE_DISABLED', __('api.ai_feature_disabled'), null, 403);
        }

        $limitCheck = AiUserLimit::canMakeRequest($userId);
        if (!$limitCheck['allowed']) {
            return $this->respondWithError('RATE_LIMIT', __('api.ai_rate_limit'), null, 429);
        }

        $title = trim($this->input('title', ''));
        $context = $this->input('context', []);

        if (empty($title)) {
            return $this->respondWithError('VALIDATION_REQUIRED_FIELD', __('api.title_required'), 'title', 400);
        }

        try {
            $aiProvider = $this->aiServiceFactory->getProvider();
            $prompt = $this->buildEventPrompt($userId, $title, $context);

            $messages = [
                ['role' => 'system', 'content' => $this->getEventGenerationSystemPrompt()],
                ['role' => 'user', 'content' => $prompt],
            ];

            $response = $aiProvider->chat($messages, ['temperature' => 0.7, 'max_tokens' => 800]);

            AiUserLimit::incrementUsage($userId);
            AiUsage::log($userId, $aiProvider->getId(), 'generate_event', [
                'tokens_input' => $response['tokens_input'] ?? 0,
                'tokens_output' => $response['tokens_output'] ?? 0,
            ]);

            return $this->respondWithData([
                'success' => true,
                'content' => trim($response['content']),
            ]);
        } catch (\Exception $e) {
            \Illuminate\Support\Facades\Log::warning("AI generateEvent error: " . $e->getMessage());
            return $this->respondWithError('AI_ERROR', $this->getFriendlyAiErrorMessage($e), null, 500);
        }
    }

    /** POST /api/v2/ai/generate/message */
    public function generateMessage(): JsonResponse
    {
        $userId = $this->requireAuth();

        if (!$this->aiServiceFactory->isFeatureEnabled('content_generation')) {
            return $this->respondWithError('FEATURE_DISABLED', __('api.ai_feature_disabled'), null, 403);
        }

        $limitCheck = AiUserLimit::canMakeRequest($userId);
        if (!$limitCheck['allowed']) {
            return $this->respondWithError('RATE_LIMIT', __('api.ai_rate_limit'), null, 429);
        }

        $originalMessage = trim($this->input('original_message', ''));
        $context = $this->input('context', []);
        $tone = $this->input('tone', 'friendly');

        if (empty($originalMessage)) {
            return $this->respondWithError('VALIDATION_REQUIRED_FIELD', __('api.ai_original_message_required'), 'original_message', 400);
        }

        try {
            $aiProvider = $this->aiServiceFactory->getProvider();

            $prompt = "Suggest a reply to this message on a community timebank platform.\n\n";
            $prompt .= "## ORIGINAL MESSAGE\n{$originalMessage}\n\n";

            if (!empty($context['listing_title'])) {
                $prompt .= "## CONTEXT\nThis is about the listing: \"{$context['listing_title']}\"\n\n";
            }

            $prompt .= "## INSTRUCTIONS\n";
            $prompt .= "Write a {$tone} reply (2-4 sentences) that:\n";
            $prompt .= "- Responds appropriately to what was said\n";
            $prompt .= "- Moves the conversation forward\n";
            $prompt .= "- Sounds natural and human\n";
            $prompt .= "\n**Return ONLY the reply text, no labels or formatting.**";

            $messages = [
                ['role' => 'system', 'content' => 'You help timebank community members communicate effectively. Write natural, friendly messages that sound like they come from a real person, not a bot.'],
                ['role' => 'user', 'content' => $prompt],
            ];

            $response = $aiProvider->chat($messages, ['temperature' => 0.8, 'max_tokens' => 300]);

            AiUserLimit::incrementUsage($userId);
            AiUsage::log($userId, $aiProvider->getId(), 'generate_message', [
                'tokens_input' => $response['tokens_input'] ?? 0,
                'tokens_output' => $response['tokens_output'] ?? 0,
            ]);

            return $this->respondWithData([
                'success' => true,
                'content' => trim($response['content']),
            ]);
        } catch (\Exception $e) {
            \Illuminate\Support\Facades\Log::warning("AI generateMessage error: " . $e->getMessage());
            return $this->respondWithError('AI_ERROR', $this->getFriendlyAiErrorMessage($e), null, 500);
        }
    }

    /** POST /api/v2/ai/generate/bio */
    public function generateBio(): JsonResponse
    {
        $userId = $this->requireAuth();

        if (!$this->aiServiceFactory->isFeatureEnabled('content_generation')) {
            return $this->respondWithError('FEATURE_DISABLED', __('api.ai_feature_disabled'), null, 403);
        }

        $limitCheck = AiUserLimit::canMakeRequest($userId);
        if (!$limitCheck['allowed']) {
            return $this->respondWithError('RATE_LIMIT', __('api.ai_rate_limit'), null, 429);
        }

        $existingBio = trim($this->input('existing_bio', ''));
        $interests = $this->input('interests', []);
        $skills = $this->input('skills', []);

        try {
            $aiProvider = $this->aiServiceFactory->getProvider();
            $tenantId = $this->getTenantId();

            $listings = DB::select(
                "SELECT title, type FROM listings WHERE user_id = ? AND tenant_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 5",
                [$userId, $tenantId]
            );

            $prompt = "Write a friendly bio for a timebank community member.\n\n";

            if (!empty($existingBio)) {
                $prompt .= "## CURRENT BIO TO IMPROVE\n{$existingBio}\n\n";
            }

            if (!empty($listings)) {
                $prompt .= "## THEIR LISTINGS\n";
                foreach ($listings as $listing) {
                    $prompt .= "- [{$listing->type}] {$listing->title}\n";
                }
                $prompt .= "\n";
            }

            if (!empty($interests) && is_array($interests)) {
                $prompt .= "## INTERESTS\n" . implode(', ', $interests) . "\n\n";
            }

            if (!empty($skills) && is_array($skills)) {
                $prompt .= "## SKILLS\n" . implode(', ', $skills) . "\n\n";
            }

            $prompt .= "## INSTRUCTIONS\n";
            $prompt .= "Write a warm, engaging bio (2-3 sentences, under 150 words) that:\n";
            $prompt .= "- Introduces them as a community member\n";
            $prompt .= "- Highlights what they can offer or are interested in\n";
            $prompt .= "- Sounds friendly and approachable\n";
            $prompt .= "\n**Return ONLY the bio text.**";

            $messages = [
                ['role' => 'system', 'content' => 'You write authentic, friendly bios for community members. Keep them genuine and avoid clichés.'],
                ['role' => 'user', 'content' => $prompt],
            ];

            $response = $aiProvider->chat($messages, ['temperature' => 0.7, 'max_tokens' => 250]);

            AiUserLimit::incrementUsage($userId);
            AiUsage::log($userId, $aiProvider->getId(), 'generate_bio', [
                'tokens_input' => $response['tokens_input'] ?? 0,
                'tokens_output' => $response['tokens_output'] ?? 0,
            ]);

            return $this->respondWithData([
                'success' => true,
                'content' => trim($response['content']),
            ]);
        } catch (\Exception $e) {
            \Illuminate\Support\Facades\Log::warning("AI generateBio error: " . $e->getMessage());
            return $this->respondWithError('AI_ERROR', $this->getFriendlyAiErrorMessage($e), null, 500);
        }
    }

    // =====================================================================
    // CONTENT GENERATION — Admin-facing
    // =====================================================================

    /** POST /api/v2/ai/generate/newsletter */
    public function generateNewsletter(): JsonResponse
    {
        $userId = $this->requireAdmin();

        if (!$this->aiServiceFactory->isFeatureEnabled('content_generation')) {
            return $this->respondWithError('FEATURE_DISABLED', __('api.ai_feature_disabled'), null, 403);
        }

        $limitCheck = AiUserLimit::canMakeRequest($userId);
        if (!$limitCheck['allowed']) {
            return $this->respondWithError('RATE_LIMIT', __('api.ai_rate_limit'), null, 429);
        }

        $type = $this->input('type', 'subject');
        $context = $this->input('context', []);

        try {
            $aiProvider = $this->aiServiceFactory->getProvider();
            $prompt = $this->buildNewsletterPrompt($type, $context);

            if ($type === 'content') {
                \Illuminate\Support\Facades\Log::warning("AI Newsletter Prompt (first 2000 chars): " . substr($prompt, 0, 2000));
            }

            $messages = [
                ['role' => 'system', 'content' => $this->getNewsletterSystemPrompt()],
                ['role' => 'user', 'content' => $prompt],
            ];

            $response = $aiProvider->chat($messages, [
                'temperature' => 0.7,
                'max_tokens' => $type === 'content' ? 2000 : 500,
            ]);

            AiUserLimit::incrementUsage($userId);
            AiUsage::log($userId, $aiProvider->getId(), 'generate_newsletter', [
                'tokens_input' => $response['tokens_input'] ?? 0,
                'tokens_output' => $response['tokens_output'] ?? 0,
            ]);

            return $this->respondWithData([
                'success' => true,
                'content' => trim($response['content']),
                'type' => $type,
            ]);
        } catch (\Exception $e) {
            \Illuminate\Support\Facades\Log::warning("AI generateNewsletter error: " . $e->getMessage());
            return $this->respondWithError('AI_ERROR', $this->getFriendlyAiErrorMessage($e), null, 500);
        }
    }

    /** POST /api/v2/ai/generate/blog */
    public function generateBlog(): JsonResponse
    {
        $userId = $this->requireAdmin();

        if (!$this->aiServiceFactory->isFeatureEnabled('content_generation')) {
            return $this->respondWithError('FEATURE_DISABLED', __('api.ai_feature_disabled'), null, 403);
        }

        $limitCheck = AiUserLimit::canMakeRequest($userId);
        if (!$limitCheck['allowed']) {
            return $this->respondWithError('RATE_LIMIT', __('api.ai_rate_limit'), null, 429);
        }

        $type = $this->input('type', 'content');
        $context = $this->input('context', []);

        try {
            $aiProvider = $this->aiServiceFactory->getProvider();
            $prompt = $this->buildBlogPrompt($type, $context);

            $messages = [
                ['role' => 'system', 'content' => $this->getBlogSystemPrompt()],
                ['role' => 'user', 'content' => $prompt],
            ];

            $response = $aiProvider->chat($messages, [
                'temperature' => 0.7,
                'max_tokens' => $type === 'content' ? 3000 : 500,
            ]);

            AiUserLimit::incrementUsage($userId);
            AiUsage::log($userId, $aiProvider->getId(), 'generate_blog', [
                'tokens_input' => $response['tokens_input'] ?? 0,
                'tokens_output' => $response['tokens_output'] ?? 0,
            ]);

            return $this->respondWithData([
                'success' => true,
                'content' => trim($response['content']),
                'type' => $type,
            ]);
        } catch (\Exception $e) {
            \Illuminate\Support\Facades\Log::warning("AI generateBlog error: " . $e->getMessage());
            return $this->respondWithError('AI_ERROR', $this->getFriendlyAiErrorMessage($e), null, 500);
        }
    }

    /** POST /api/v2/ai/generate/page */
    public function generatePage(): JsonResponse
    {
        $userId = $this->requireAdmin();

        if (!$this->aiServiceFactory->isFeatureEnabled('content_generation')) {
            return $this->respondWithError('FEATURE_DISABLED', __('api.ai_feature_disabled'), null, 403);
        }

        $limitCheck = AiUserLimit::canMakeRequest($userId);
        if (!$limitCheck['allowed']) {
            return $this->respondWithError('RATE_LIMIT', __('api.ai_rate_limit'), null, 429);
        }

        $type = $this->input('type', 'section');
        $context = $this->input('context', []);

        try {
            $aiProvider = $this->aiServiceFactory->getProvider();
            $prompt = $this->buildPagePrompt($type, $context);

            $messages = [
                ['role' => 'system', 'content' => $this->getPageSystemPrompt()],
                ['role' => 'user', 'content' => $prompt],
            ];

            $response = $aiProvider->chat($messages, [
                'temperature' => 0.7,
                'max_tokens' => $type === 'full' ? 3000 : 1000,
            ]);

            AiUserLimit::incrementUsage($userId);
            AiUsage::log($userId, $aiProvider->getId(), 'generate_page', [
                'tokens_input' => $response['tokens_input'] ?? 0,
                'tokens_output' => $response['tokens_output'] ?? 0,
            ]);

            return $this->respondWithData([
                'success' => true,
                'content' => trim($response['content']),
                'type' => $type,
            ]);
        } catch (\Exception $e) {
            \Illuminate\Support\Facades\Log::warning("AI generatePage error: " . $e->getMessage());
            return $this->respondWithError('AI_ERROR', $this->getFriendlyAiErrorMessage($e), null, 500);
        }
    }

    // =====================================================================
    // PRIVATE — Prompt builders & system prompts
    // =====================================================================

    /**
     * Convert technical AI errors to user-friendly messages.
     */
    private function getFriendlyAiErrorMessage(\Exception $e): string
    {
        $message = $e->getMessage();

        if (strpos($message, '429') !== false || stripos($message, 'quota') !== false || stripos($message, 'rate') !== false) {
            return "I'm getting a lot of requests right now. Please wait a moment and try again.";
        }
        if (stripos($message, 'api key') !== false || stripos($message, 'unauthorized') !== false || strpos($message, '401') !== false) {
            return "There's a configuration issue with the AI service. Please contact an administrator.";
        }
        if (stripos($message, 'not found') !== false && stripos($message, 'model') !== false) {
            return "The AI model is temporarily unavailable. Please try again later.";
        }
        if (stripos($message, 'curl') !== false || stripos($message, 'connection') !== false || stripos($message, 'timeout') !== false) {
            return "I couldn't connect to the AI service. Please check your internet connection and try again.";
        }
        if (stripos($message, 'safety') !== false || stripos($message, 'blocked') !== false || stripos($message, 'filter') !== false) {
            return "I couldn't process that request. Please try rephrasing your message.";
        }
        if (stripos($message, 'token') !== false || stripos($message, 'length') !== false || stripos($message, 'too long') !== false) {
            return "Your message is too long. Please try a shorter message.";
        }
        if (strpos($message, '500') !== false || strpos($message, '502') !== false || strpos($message, '503') !== false) {
            return "The AI service is temporarily down. Please try again in a few minutes.";
        }

        return "Something went wrong. Please try again. If the problem persists, contact support.";
    }

    /**
     * Get user profile context for personalized generation.
     */
    private function getUserProfileContext(int $userId): string
    {
        $context = '';

        try {
            $tenantId = $this->getTenantId();

            $user = DB::selectOne("SELECT name, bio, location FROM users WHERE id = ? AND tenant_id = ?", [$userId, $tenantId]);

            if ($user) {
                if (!empty($user->name)) {
                    $context .= "- Name: {$user->name}\n";
                }
                if (!empty($user->location)) {
                    $context .= "- Location: {$user->location}\n";
                }
                if (!empty($user->bio)) {
                    $bio = mb_strlen($user->bio) > 200 ? mb_substr($user->bio, 0, 200) . '...' : $user->bio;
                    $context .= "- Bio: {$bio}\n";
                }
            }

            $listings = DB::select(
                "SELECT title, type FROM listings WHERE user_id = ? AND tenant_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 3",
                [$userId, $tenantId]
            );

            if (!empty($listings)) {
                $listingTitles = array_map(fn($l) => "[{$l->type}] {$l->title}", $listings);
                $context .= "- Other listings: " . implode(', ', $listingTitles) . "\n";
            }
        } catch (\Exception $e) {
            // Silently fail - context is optional
        }

        return $context;
    }

    /**
     * Build a rich prompt for listing generation.
     */
    private function buildListingPrompt(int $userId, string $title, string $type, array $context): string
    {
        $isOffer = ($type === 'offer');
        $typeLabel = $isOffer ? 'Offer' : 'Request';

        $userPrompt = $context['user_prompt'] ?? '';
        $hasUserPrompt = !empty($userPrompt);

        $prompt = "# TASK: Write a Timebank Listing Description\n\n";
        $prompt .= "You must write a compelling description for a community timebank listing. ";
        $prompt .= "Use ALL the details provided below to create a specific, personalized description.\n\n";

        $prompt .= "## MANDATORY INFORMATION TO INCORPORATE\n\n";
        $prompt .= "**Listing Type:** {$typeLabel}\n";
        $prompt .= "- This is " . ($isOffer ? "an OFFER where I'm sharing my skills/services with others" : "a REQUEST where I need help from the community") . "\n\n";

        if ($hasUserPrompt) {
            $prompt .= "**USER'S REQUEST (THIS IS THE MAIN INPUT - FOLLOW IT CLOSELY):**\n";
            $prompt .= "---\n{$userPrompt}\n---\n";
            $prompt .= "Write a listing description based on what the user described above. This is what they want to offer or request.\n\n";

            if (!empty($title)) {
                $prompt .= "**Title (optional context):** \"{$title}\"\n\n";
            }
        } else {
            $prompt .= "**Title:** \"{$title}\"\n";
            $prompt .= "- The title tells you what this listing is about. Use it as the core topic.\n\n";
        }

        if (!empty($context['category'])) {
            $prompt .= "**Category:** {$context['category']}\n";
            $prompt .= "- This categorizes the type of service. Incorporate language appropriate to this category.\n\n";
        }

        if (!empty($context['listing_type'])) {
            $type = $context['listing_type'];
            $isOffer = ($type === 'offer');
        }

        if (!empty($context['attributes']) && is_array($context['attributes'])) {
            $prompt .= "**Service Features Selected:** " . implode(', ', $context['attributes']) . "\n";
            $prompt .= "- These features MUST be mentioned or implied in the description. They describe the service's characteristics.\n\n";
        }

        if (!empty($context['sdg_goals']) && is_array($context['sdg_goals'])) {
            $prompt .= "**Social Impact Goals:** " . implode(', ', $context['sdg_goals']) . "\n";
            $prompt .= "- Subtly weave in how this service contributes to these goals. Don't list them explicitly.\n\n";
        }

        $userContext = $this->getUserProfileContext($userId);
        if ($userContext) {
            $prompt .= "## ABOUT THE PERSON POSTING\n{$userContext}\n";
            $prompt .= "Use this background to add authenticity and personalization.\n\n";
        }

        if (!empty($context['existing_description'])) {
            $prompt .= "## EXISTING DRAFT TO IMPROVE\n";
            $prompt .= "The user wrote this draft:\n";
            $prompt .= "---\n{$context['existing_description']}\n---\n\n";
            $prompt .= "Enhance this while keeping their voice and intent. Make it more engaging, specific, and complete.\n\n";
        }

        $prompt .= "## OUTPUT REQUIREMENTS\n\n";
        $prompt .= "Write 2-3 paragraphs (100-200 words) that:\n";

        if ($isOffer) {
            $prompt .= "1. Opens with what you're offering and why you enjoy it\n";
            $prompt .= "2. Describes your approach/experience and who benefits most\n";
            $prompt .= "3. Mentions practical details (flexibility, what to bring/expect)\n";
            $prompt .= "4. Ends with a warm invitation to connect\n";
        } else {
            $prompt .= "1. Opens with what help you need and why it matters\n";
            $prompt .= "2. Describes the ideal helper and what you're hoping for\n";
            $prompt .= "3. Mentions timeline, flexibility, or other relevant details\n";
            $prompt .= "4. Ends warmly, expressing appreciation for community support\n";
        }

        $prompt .= "\n**Writing Style:**\n";
        $prompt .= "- First person, warm, conversational\n";
        $prompt .= "- Specific and detailed (NOT generic filler text)\n";
        $prompt .= "- Authentic human voice, avoid corporate speak\n";
        $prompt .= "- Reference the specific details provided above\n";

        $prompt .= "\n**OUTPUT FORMAT:** Return ONLY the description paragraphs. No title, headers, bullet points, or other formatting.";

        return $prompt;
    }

    /**
     * Build a rich prompt for event generation.
     */
    private function buildEventPrompt(int $userId, string $title, array $context): string
    {
        $prompt = "# TASK: Write a Community Event Description\n\n";
        $prompt .= "Create an engaging event description using ALL the details provided below. ";
        $prompt .= "The description should make people excited to attend.\n\n";

        $prompt .= "## MANDATORY INFORMATION TO INCORPORATE\n\n";
        $prompt .= "**Event Title:** \"{$title}\"\n";
        $prompt .= "- This is the event's name. Use it as the core theme.\n\n";

        if (!empty($context['category'])) {
            $prompt .= "**Category:** {$context['category']}\n";
            $prompt .= "- This tells you what type of event it is. Match the tone and vocabulary.\n\n";
        }

        if (!empty($context['location'])) {
            $prompt .= "**Location:** {$context['location']}\n";
            $prompt .= "- Mention or reference the location naturally in the description.\n\n";
        }

        if (!empty($context['start_date'])) {
            $dateStr = $context['start_date'];
            if (!empty($context['start_time'])) {
                $dateStr .= ' at ' . $context['start_time'];
            }

            $prompt .= "**When:** {$dateStr}";

            if (!empty($context['end_time'])) {
                $prompt .= " until {$context['end_time']}";
            }
            $prompt .= "\n";

            if (!empty($context['start_time']) && !empty($context['end_time']) &&
                (empty($context['end_date']) || $context['end_date'] === $context['start_date'])) {
                try {
                    $start = new \DateTime($context['start_time']);
                    $end = new \DateTime($context['end_time']);
                    $diff = $start->diff($end);
                    $hours = $diff->h + ($diff->i / 60);
                    if ($hours > 0) {
                        $prompt .= "**Duration:** approximately " . round($hours, 1) . " hours\n";
                    }
                } catch (\Exception $e) {
                    // Ignore date parsing errors
                }
            }
            $prompt .= "- Reference the timing naturally (e.g., 'Join us this Saturday afternoon...')\n\n";
        }

        if (!empty($context['group_name'])) {
            $prompt .= "**Hosted by:** {$context['group_name']}\n";
            $prompt .= "- This is the community hub organizing the event. Mention it.\n\n";
        }

        if (!empty($context['sdg_goals']) && is_array($context['sdg_goals'])) {
            $prompt .= "**Social Impact:** " . implode(', ', $context['sdg_goals']) . "\n";
            $prompt .= "- Subtly weave in how this event contributes to community well-being.\n\n";
        }

        $userContext = $this->getUserProfileContext($userId);
        if ($userContext) {
            $prompt .= "## ABOUT THE HOST\n{$userContext}\n";
            $prompt .= "Use this to add a personal touch to the invitation.\n\n";
        }

        if (!empty($context['existing_description'])) {
            $prompt .= "## EXISTING DRAFT TO IMPROVE\n";
            $prompt .= "The host wrote this draft:\n";
            $prompt .= "---\n{$context['existing_description']}\n---\n\n";
            $prompt .= "Enhance this while keeping their voice. Make it more engaging and complete.\n\n";
        }

        $prompt .= "## OUTPUT REQUIREMENTS\n\n";
        $prompt .= "Write 2-3 paragraphs (100-200 words) that:\n";
        $prompt .= "1. Opens with an engaging hook about what makes this event special\n";
        $prompt .= "2. Describes what attendees will experience, learn, or do\n";
        $prompt .= "3. Mentions who should come (skill level, interests, everyone welcome?)\n";
        $prompt .= "4. Ends with a warm invitation to join\n";

        $prompt .= "\n**Writing Style:**\n";
        $prompt .= "- Enthusiastic but genuine (not salesy or over-the-top)\n";
        $prompt .= "- Specific details from the information above\n";
        $prompt .= "- Community-focused, welcoming tone\n";
        $prompt .= "- First person when appropriate ('We're excited to host...')\n";

        $prompt .= "\n**OUTPUT FORMAT:** Return ONLY the description paragraphs. No title, headers, bullet points, or other formatting.";

        return $prompt;
    }

    /**
     * Build newsletter generation prompt with real platform data.
     */
    private function buildNewsletterPrompt(string $type, array $context): string
    {
        $topic = $context['topic'] ?? '';
        $audience = $context['audience'] ?? 'community members';
        $tone = $context['tone'] ?? 'friendly and engaging';
        $existingSubject = $context['subject'] ?? '';
        $template = $context['template'] ?? '';
        $existingContent = $context['existing_content'] ?? '';
        $userPrompt = $context['user_prompt'] ?? '';

        $platformData = $this->getNewsletterPlatformData();
        $platformName = $platformData['platform_name'];

        $prompt = "# TASK: Generate Newsletter ";

        switch ($type) {
            case 'subject':
                $prompt .= "Subject Line for {$platformName}\n\n";
                $prompt .= $this->formatPlatformDataForPrompt($platformData);
                $prompt .= "## REQUIREMENTS\n";
                $prompt .= "Generate 3 compelling email subject lines for this community newsletter.\n\n";
                if ($userPrompt) {
                    $prompt .= "**Admin's Instructions:** {$userPrompt}\n\n";
                }
                if ($topic) {
                    $prompt .= "**Topic/Theme:** {$topic}\n";
                }
                $prompt .= "**Target Audience:** {$audience}\n";
                $prompt .= "**Tone:** {$tone}\n\n";
                $prompt .= "## OUTPUT FORMAT\n";
                $prompt .= "Return exactly 3 subject lines, one per line, numbered 1-3.\n";
                $prompt .= "Each should be under 60 characters for mobile compatibility.\n";
                $prompt .= "Reference REAL data from above (actual events, listings, stats).\n";
                $prompt .= "Make them specific to this community, not generic.\n";
                break;

            case 'preview':
                $prompt .= "Preview Text for {$platformName}\n\n";
                $prompt .= "## REQUIREMENTS\n";
                $prompt .= "Generate preview text that appears after the subject line in email clients.\n\n";
                if ($existingSubject) {
                    $prompt .= "**Subject Line:** {$existingSubject}\n";
                }
                if ($topic) {
                    $prompt .= "**Topic:** {$topic}\n";
                }
                $prompt .= "\n## OUTPUT FORMAT\n";
                $prompt .= "Return a single preview text, 40-90 characters.\n";
                $prompt .= "It should complement the subject line and encourage opening.\n";
                break;

            case 'content':
                $prompt .= "Body Content for {$platformName}\n\n";
                $prompt .= $this->formatPlatformDataForPrompt($platformData);
                $prompt .= "## ⚠️ ABSOLUTE RULES - VIOLATION WILL FAIL ⚠️\n\n";
                $prompt .= "**STOP! READ THIS CAREFULLY BEFORE WRITING:**\n\n";
                $prompt .= "1. **NEVER INVENT NAMES** - Do NOT create fake names like 'Sarah', 'Mike', 'Jennifer'. If you need to mention a member, use ONLY the real names from the data above.\n";
                $prompt .= "2. **NEVER INVENT LISTINGS** - Do NOT make up services like 'sourdough baking' or 'computer troubleshooting' unless they appear in the REAL data above.\n";
                $prompt .= "3. **NEVER INVENT EVENTS** - Do NOT create fake events like 'Monthly Meetup' or 'Skills Workshop'. Use ONLY the real events listed above.\n";
                $prompt .= "4. **NEVER INVENT STATISTICS** - Do NOT say '3 people learned' or '5 households helped'. Use ONLY the real stats provided.\n";
                $prompt .= "5. **IF NO DATA EXISTS** - Write a general newsletter encouraging people to post listings and join the community. Do NOT fill it with made-up content.\n\n";
                $prompt .= "**WHAT TO DO INSTEAD:**\n";
                $prompt .= "- If real offers exist above, feature those exact titles and member names\n";
                $prompt .= "- If real events exist above, promote those exact events with real dates\n";
                $prompt .= "- If no data, write about the benefits of timebanking and encourage participation\n";
                $prompt .= "- Keep it honest and authentic - empty community = encourage first posts\n\n";

                if (!empty($existingContent) && strlen(trim($existingContent)) > 20) {
                    $prompt .= "## USER'S CONTENT FRAMEWORK (FOLLOW THIS CLOSELY)\n";
                    $prompt .= "The admin has written the following as guidance for what they want:\n";
                    $prompt .= "---\n{$existingContent}\n---\n\n";
                    $prompt .= "Expand and enhance this into a polished newsletter while keeping their intent and structure.\n";
                    $prompt .= "If they mention specific topics, focus on those using the real data above.\n\n";
                }

                if ($userPrompt) {
                    $prompt .= "## ADMIN'S SPECIFIC INSTRUCTIONS\n";
                    $prompt .= "{$userPrompt}\n\n";
                }

                $prompt .= "## NEWSLETTER DETAILS\n";
                if ($existingSubject) {
                    $prompt .= "**Subject:** {$existingSubject}\n";
                }
                if ($topic) {
                    $prompt .= "**Topic/Theme:** {$topic}\n";
                }
                $prompt .= "**Target Audience:** {$audience}\n";
                $prompt .= "**Tone:** {$tone}\n";

                if ($template) {
                    $prompt .= "\n## TEMPLATE TYPE: " . strtoupper($template) . "\n";
                    switch ($template) {
                        case 'weekly':
                        case 'weekly-digest':
                            $prompt .= "Focus on: This week's highlights, new listings, upcoming events, member spotlight\n";
                            break;
                        case 'monthly':
                        case 'monthly-digest':
                            $prompt .= "Focus on: Monthly stats, community achievements, featured members, upcoming events\n";
                            break;
                        case 'event':
                        case 'event-announcement':
                            $prompt .= "Focus on: Featured upcoming event(s), why to attend, how to RSVP\n";
                            break;
                        case 'welcome':
                            $prompt .= "Focus on: Welcoming new members, how to get started, first steps\n";
                            break;
                        case 'announcement':
                            $prompt .= "Focus on: Important community news or updates\n";
                            break;
                        default:
                            $prompt .= "General community update newsletter\n";
                    }
                }

                $prompt .= "\n## OUTPUT FORMAT\n";
                $prompt .= "Write the newsletter body in clean HTML format.\n";
                $prompt .= "Structure:\n";
                $prompt .= "- Warm greeting using {{first_name}}\n";
                $prompt .= "- 2-3 content sections with <h2> headings\n";
                $prompt .= "- Feature REAL listings/events from the data above\n";
                $prompt .= "- Clear call-to-action (browse listings, attend event, etc.)\n";
                $prompt .= "- Friendly sign-off\n\n";
                $prompt .= "Use semantic HTML: h2, h3, p, ul, li, strong, a tags.\n";
                $prompt .= "Keep it scannable: short paragraphs, bullet points for lists.\n";
                $prompt .= "Length: 300-500 words.\n";
                $prompt .= "Personalization: Use {{first_name}} in greeting.\n";
                $prompt .= "\n**IMPORTANT:** Output ONLY the HTML content, no explanations or markdown.\n";
                break;

            case 'subject_ab':
                $prompt .= "A/B Test Subject Line Variant\n\n";
                $prompt .= "## REQUIREMENTS\n";
                $prompt .= "Create an alternative subject line for A/B testing.\n\n";
                $prompt .= "**Original Subject (A):** {$existingSubject}\n";
                if ($topic) {
                    $prompt .= "**Topic:** {$topic}\n";
                }
                $prompt .= "\n## OUTPUT FORMAT\n";
                $prompt .= "Return a single alternative subject line that:\n";
                $prompt .= "- Takes a different angle or approach\n";
                $prompt .= "- Has similar length (under 60 chars)\n";
                $prompt .= "- Tests a different emotional appeal or hook\n";
                break;

            default:
                $prompt .= "Content\n\n";
                $prompt .= "Generate appropriate newsletter content based on context.\n";
        }

        return $prompt;
    }

    /**
     * Build blog generation prompt.
     */
    private function buildBlogPrompt(string $type, array $context): string
    {
        $title = $context['title'] ?? '';
        $topic = $context['topic'] ?? '';
        $category = $context['category'] ?? '';
        $keywords = $context['keywords'] ?? '';
        $existingContent = $context['existing_content'] ?? '';

        $prompt = "# TASK: Generate Blog ";

        switch ($type) {
            case 'title':
                $prompt .= "Title\n\n";
                $prompt .= "## REQUIREMENTS\n";
                $prompt .= "Generate 3 compelling blog post titles.\n\n";
                if ($topic) {
                    $prompt .= "**Topic:** {$topic}\n";
                }
                if ($category) {
                    $prompt .= "**Category:** {$category}\n";
                }
                if ($keywords) {
                    $prompt .= "**Keywords to include:** {$keywords}\n";
                }
                $prompt .= "\n## OUTPUT FORMAT\n";
                $prompt .= "Return exactly 3 titles, one per line, numbered 1-3.\n";
                $prompt .= "Each should be engaging, SEO-friendly, and under 70 characters.\n";
                break;

            case 'excerpt':
                $prompt .= "Excerpt/Summary\n\n";
                $prompt .= "## REQUIREMENTS\n";
                $prompt .= "Generate a compelling excerpt for the blog post.\n\n";
                if ($title) {
                    $prompt .= "**Title:** {$title}\n";
                }
                if ($existingContent) {
                    $prompt .= "**Content Preview:** " . substr($existingContent, 0, 500) . "...\n";
                }
                $prompt .= "\n## OUTPUT FORMAT\n";
                $prompt .= "Return a single excerpt paragraph (2-3 sentences, 150-200 characters).\n";
                $prompt .= "It should hook readers and summarize the value of the article.\n";
                break;

            case 'content':
                $prompt .= "Article Content\n\n";
                $prompt .= "## REQUIREMENTS\n";
                $prompt .= "Write a complete blog article for a community timebank platform.\n\n";
                if ($title) {
                    $prompt .= "**Title:** {$title}\n";
                }
                if ($topic) {
                    $prompt .= "**Topic:** {$topic}\n";
                }
                if ($category) {
                    $prompt .= "**Category:** {$category}\n";
                }
                if ($keywords) {
                    $prompt .= "**Keywords:** {$keywords}\n";
                }
                $prompt .= "\n## OUTPUT FORMAT\n";
                $prompt .= "Write the article in clean HTML format.\n";
                $prompt .= "Structure:\n";
                $prompt .= "- Engaging introduction (hook the reader)\n";
                $prompt .= "- 3-4 main sections with h2 headings\n";
                $prompt .= "- Practical tips or actionable advice\n";
                $prompt .= "- Strong conclusion with call-to-action\n\n";
                $prompt .= "Use semantic HTML (h2, h3, p, ul, li, strong, em).\n";
                $prompt .= "Length: 600-1000 words.\n";
                $prompt .= "Tone: Informative, friendly, community-focused.\n";
                break;

            case 'seo':
                $prompt .= "SEO Meta Data\n\n";
                $prompt .= "## REQUIREMENTS\n";
                $prompt .= "Generate SEO meta title and description.\n\n";
                if ($title) {
                    $prompt .= "**Article Title:** {$title}\n";
                }
                if ($existingContent) {
                    $prompt .= "**Content Preview:** " . substr(strip_tags($existingContent), 0, 500) . "...\n";
                }
                $prompt .= "\n## OUTPUT FORMAT\n";
                $prompt .= "Return in this exact format:\n";
                $prompt .= "META_TITLE: [title under 60 chars]\n";
                $prompt .= "META_DESCRIPTION: [description 150-160 chars]\n";
                break;

            case 'improve':
                $prompt .= "Content Improvement\n\n";
                $prompt .= "## REQUIREMENTS\n";
                $prompt .= "Improve the existing blog content.\n\n";
                if ($title) {
                    $prompt .= "**Title:** {$title}\n";
                }
                $prompt .= "**Current Content:**\n{$existingContent}\n\n";
                $prompt .= "## IMPROVEMENTS NEEDED\n";
                $prompt .= "- Enhance readability and flow\n";
                $prompt .= "- Add more specific details or examples\n";
                $prompt .= "- Strengthen the introduction and conclusion\n";
                $prompt .= "- Improve formatting with proper headings\n\n";
                $prompt .= "Return the improved HTML content only.\n";
                break;

            default:
                $prompt .= "Content\n\n";
                $prompt .= "Generate appropriate blog content based on context.\n";
        }

        return $prompt;
    }

    /**
     * Build page generation prompt.
     */
    private function buildPagePrompt(string $type, array $context): string
    {
        $pageTitle = $context['page_title'] ?? $context['title'] ?? '';
        $purpose = $context['prompt'] ?? $context['purpose'] ?? '';
        $existingContent = $context['existing_content'] ?? '';

        $prompt = "# TASK: Generate Page ";

        switch ($type) {
            case 'hero':
                $prompt .= "Hero Section\n\n";
                $prompt .= "## REQUIREMENTS\n";
                $prompt .= "Generate a compelling hero section for a webpage.\n\n";
                if ($pageTitle) {
                    $prompt .= "**Page Title:** {$pageTitle}\n";
                }
                if ($purpose) {
                    $prompt .= "**User's Description:** {$purpose}\n";
                }
                $prompt .= "\n## OUTPUT FORMAT\n";
                $prompt .= "Return HTML for a hero section with:\n";
                $prompt .= "- Main headline (h1)\n";
                $prompt .= "- Supporting subheadline (p)\n";
                $prompt .= "- Call-to-action button\n";
                $prompt .= "- Background styling (gradient or solid color)\n\n";
                $prompt .= "Use inline styles for spacing/alignment.\n";
                $prompt .= "Keep text concise and impactful.\n";
                $prompt .= "Make sure the section has substantial padding (60-100px top/bottom).\n";
                break;

            case 'section':
                $prompt .= "Content Section\n\n";
                $prompt .= "## REQUIREMENTS\n";
                $prompt .= "Generate a content section for the page.\n\n";
                if ($pageTitle) {
                    $prompt .= "**Page Title:** {$pageTitle}\n";
                }
                if ($purpose) {
                    $prompt .= "**User's Description:** {$purpose}\n";
                }
                $prompt .= "\n## OUTPUT FORMAT\n";
                $prompt .= "Return HTML for a content section with:\n";
                $prompt .= "- Section heading (h2)\n";
                $prompt .= "- 2-3 paragraphs of content\n";
                $prompt .= "- Optional bullet points or features\n\n";
                $prompt .= "Use inline styles for padding (40-60px), good line-height.\n";
                $prompt .= "Make content relevant to a timebank community platform.\n";
                break;

            case 'cta':
                $prompt .= "Call-to-Action Section\n\n";
                $prompt .= "## REQUIREMENTS\n";
                $prompt .= "Generate a compelling CTA section.\n\n";
                if ($purpose) {
                    $prompt .= "**User's Description:** {$purpose}\n";
                }
                $prompt .= "\n## OUTPUT FORMAT\n";
                $prompt .= "Return HTML for a CTA section with:\n";
                $prompt .= "- Compelling headline\n";
                $prompt .= "- Brief supporting text\n";
                $prompt .= "- Prominent action button with good styling\n";
                $prompt .= "- Eye-catching background (gradient or solid color)\n\n";
                $prompt .= "Use inline styles with padding (50-80px).\n";
                $prompt .= "Create urgency without being pushy.\n";
                $prompt .= "Center-align the content.\n";
                break;

            case 'features':
                $prompt .= "Features/Benefits Section\n\n";
                $prompt .= "## REQUIREMENTS\n";
                $prompt .= "Generate a features section for a timebank platform page.\n\n";
                if ($purpose) {
                    $prompt .= "**User's Description:** {$purpose}\n";
                }
                $prompt .= "\n## OUTPUT FORMAT\n";
                $prompt .= "Return HTML for a 3-column features grid with:\n";
                $prompt .= "- Section title (h2)\n";
                $prompt .= "- 3 feature boxes, each with: emoji or icon, title (h3), brief description\n";
                $prompt .= "- Cards should have subtle background and padding\n\n";
                $prompt .= "Focus on timebank benefits: community, skill-sharing, time credits.\n";
                $prompt .= "Use flexbox with inline styles. Add padding (50-80px) to the section.\n";
                $prompt .= "Make cards responsive-friendly with flex-wrap.\n";
                break;

            case 'testimonials':
                $prompt .= "Testimonials Section\n\n";
                $prompt .= "## REQUIREMENTS\n";
                $prompt .= "Generate a testimonials section for a timebank community.\n\n";
                if ($purpose) {
                    $prompt .= "**User's Description:** {$purpose}\n";
                }
                $prompt .= "\n## OUTPUT FORMAT\n";
                $prompt .= "Return HTML for a testimonials section with:\n";
                $prompt .= "- Section heading (h2) like 'What Our Members Say'\n";
                $prompt .= "- 3 testimonial cards in a grid layout\n";
                $prompt .= "- Each card has: large quote marks or emoji, quote text (italic), member name (bold), brief description\n";
                $prompt .= "- Cards should have subtle shadow or border styling\n\n";
                $prompt .= "Make testimonials realistic and relatable to timebanking.\n";
                $prompt .= "Focus on community connection, skill sharing, and positive experiences.\n";
                $prompt .= "Use flexbox with inline styles. Add section padding (50-80px).\n";
                break;

            case 'faq':
                $prompt .= "FAQ Section\n\n";
                $prompt .= "## REQUIREMENTS\n";
                $prompt .= "Generate an FAQ section for a timebank platform.\n\n";
                if ($purpose) {
                    $prompt .= "**User's Description:** {$purpose}\n";
                }
                $prompt .= "\n## OUTPUT FORMAT\n";
                $prompt .= "Return HTML for an FAQ section with:\n";
                $prompt .= "- Section heading (h2) like 'Frequently Asked Questions'\n";
                $prompt .= "- 4-6 Q&A pairs relevant to timebanking\n";
                $prompt .= "- Each Q&A should be a div with: question (h3 or bold), answer (p)\n";
                $prompt .= "- Add light background or border to each Q&A item\n";
                $prompt .= "- Good vertical spacing between items\n\n";
                $prompt .= "Include questions about: how timebanking works, getting started, earning/spending time credits, safety.\n";
                $prompt .= "Use inline styles with section padding (50-80px).\n";
                break;

            case 'text':
                $prompt .= "Text Content Section\n\n";
                $prompt .= "## REQUIREMENTS\n";
                $prompt .= "Generate a text content section.\n\n";
                if ($pageTitle) {
                    $prompt .= "**Page Title:** {$pageTitle}\n";
                }
                if ($purpose) {
                    $prompt .= "**Topic:** {$purpose}\n";
                }
                $prompt .= "\n## OUTPUT FORMAT\n";
                $prompt .= "Return HTML for a content section with:\n";
                $prompt .= "- Section heading (h2)\n";
                $prompt .= "- 2-4 well-written paragraphs\n";
                $prompt .= "- Optionally include bullet points or highlights\n\n";
                $prompt .= "Write engaging, informative content relevant to a community timebank.\n";
                $prompt .= "Use inline styles for spacing and formatting.\n";
                break;

            case 'seo':
                $prompt .= "SEO Meta Data\n\n";
                $prompt .= "## REQUIREMENTS\n";
                $prompt .= "Generate SEO meta title and description for the page.\n\n";
                if ($pageTitle) {
                    $prompt .= "**Page Title:** {$pageTitle}\n";
                }
                if ($existingContent) {
                    $textContent = strip_tags($existingContent);
                    $textContent = substr($textContent, 0, 500);
                    $prompt .= "**Page Content Preview:** {$textContent}\n";
                }
                $prompt .= "\n## OUTPUT FORMAT\n";
                $prompt .= "Return in this exact format (no markdown, no extra text):\n";
                $prompt .= "META_TITLE: [title under 60 chars]\n";
                $prompt .= "META_DESCRIPTION: [description 150-160 chars]\n";
                break;

            case 'full':
                $prompt .= "Full Page Layout\n\n";
                $prompt .= "## REQUIREMENTS\n";
                $prompt .= "Generate a complete page layout for a timebank website.\n\n";
                if ($pageTitle) {
                    $prompt .= "**Page Title:** {$pageTitle}\n";
                }
                if ($purpose) {
                    $prompt .= "**Page Purpose:** {$purpose}\n";
                }
                $prompt .= "\n## OUTPUT FORMAT\n";
                $prompt .= "Return HTML for a complete page with:\n";
                $prompt .= "1. Hero section with headline and CTA\n";
                $prompt .= "2. Features/benefits section (3 columns)\n";
                $prompt .= "3. Content section explaining the platform\n";
                $prompt .= "4. Final CTA section\n\n";
                $prompt .= "Use semantic HTML and inline styles.\n";
                $prompt .= "Make it mobile-responsive with flexbox.\n";
                break;

            default:
                $prompt .= "Content\n\n";
                $prompt .= "Generate appropriate page content based on context.\n";
        }

        return $prompt;
    }

    // =====================================================================
    // PRIVATE — System prompts
    // =====================================================================

    private function getContentGenerationSystemPrompt(): string
    {
        return <<<'EOT'
You are an expert copywriter for NEXUS TimeBank, a community platform where neighbors exchange skills and services using time credits (1 hour = 1 credit).

## YOUR MISSION
Write authentic, compelling listing descriptions that help real community members connect. Every description you write should feel like it was written by a thoughtful human who genuinely wants to help their neighbors.

## CRITICAL RULES
1. **USE ALL PROVIDED DETAILS** - The user has provided specific information (category, features, goals). You MUST incorporate these into your writing. Never ignore provided context.

2. **BE SPECIFIC, NOT GENERIC** - Instead of "I have experience," say "I've been doing this for 5 years" or reference specific aspects. Generic text fails.

3. **WRITE AS THE PERSON** - Use first person ("I", "my"). Sound like a real neighbor, not a marketing department.

4. **MATCH CATEGORY TONE** - Professional services need professional-but-friendly tone. Creative/casual services can be more playful.

5. **NO FORMATTING** - Return only plain paragraph text. No headers, bullets, asterisks, or markdown.

## WHAT MAKES GREAT LISTINGS
- Opens with personality or a hook
- Mentions specific skills/experience relevant to the service
- Explains who would benefit and why
- Includes practical details (flexibility, what to expect)
- Ends with a warm, inviting call-to-action

Remember: You're helping neighbors connect. Make it real, make it warm, make it specific.
EOT;
    }

    private function getEventGenerationSystemPrompt(): string
    {
        return <<<'EOT'
You are a community events coordinator for NEXUS TimeBank, a platform where neighbors exchange skills and build community.

## YOUR MISSION
Write event descriptions that make people genuinely excited to attend. Every description should feel like a warm, personal invitation from a neighbor.

## CRITICAL RULES
1. **USE ALL PROVIDED DETAILS** - Location, time, category, hosting group - weave ALL of these into your description naturally. Don't ignore any provided information.

2. **CREATE VIVID PICTURES** - Help readers imagine themselves at the event. What will they see, do, learn, experience?

3. **BE SPECIFIC** - "Learn 3 traditional bread recipes" beats "Learn to bake bread". Details create excitement.

4. **WELCOMING TONE** - Events are for everyone. Make newcomers feel they belong.

5. **NO FORMATTING** - Return only plain paragraph text. No headers, bullets, asterisks, or markdown.

## WHAT MAKES GREAT EVENT DESCRIPTIONS
- Opens with an engaging hook or the event's unique appeal
- Clearly explains what attendees will experience
- Mentions who the event is perfect for
- References location and timing naturally
- Ends with an inviting call-to-join

Remember: These are real community gatherings. Make each one feel special and worth attending.
EOT;
    }

    private function getNewsletterSystemPrompt(): string
    {
        $tenantId = $this->getTenantId();
        $tenant = TenantContext::get();
        $platformName = $tenant['name'] ?? 'NEXUS TimeBank';

        return <<<EOT
You are a newsletter writer for {$platformName}. You write ONLY based on real data provided to you.

## CRITICAL: DO NOT HALLUCINATE

You have a serious problem with making up fake content. STOP DOING THIS.

NEVER DO THIS:
- Invent member names (no "Sarah taught sourdough", no "Mike helped with computers", no "Meet Jennifer")
- Invent statistics (no "3 people learned", no "5 households helped", no "8 new volunteers")
- Invent events (no "Monthly Meetup at Central Park", no "Skills Workshop")
- Invent testimonials or quotes from fake people
- Fill empty sections with made-up examples

INSTEAD DO THIS:
- Use ONLY the real listings, events, and member names provided in the prompt
- If the data shows 0 events, do NOT mention any events
- If no member names are provided, do NOT mention any members by name
- If data is sparse, write a shorter newsletter focused on general encouragement
- It's OK to have a simple newsletter that says "post your first listing!" if there's no activity

## ABOUT {$platformName}
A timebanking platform where neighbors exchange services using time credits (1 hour = 1 credit).

## OUTPUT FORMAT
- Clean HTML only: h2, h3, p, ul, li, strong, a
- Use {{first_name}} for recipient personalization
- NO markdown, NO code blocks, NO explanations
- Keep it concise - a short honest newsletter beats a long fake one

Remember: An empty/quiet community newsletter that encourages first posts is BETTER than a newsletter full of invented activity.
EOT;
    }

    private function getBlogSystemPrompt(): string
    {
        return <<<'EOT'
You are a content writer for NEXUS TimeBank, a community platform where neighbors exchange skills and services using time credits.

## YOUR MISSION
Create engaging, informative blog content that educates and inspires community members. Your writing should be accessible, practical, and community-focused.

## CONTENT GUIDELINES
1. **AUDIENCE** - Community members interested in timebanking, skill-sharing, and local connection
2. **TONE** - Warm, helpful, and encouraging (not corporate or academic)
3. **VALUE** - Every article should teach something practical or inspire action
4. **FORMAT** - Use clear headings, short paragraphs, bullet points for scannability
5. **SEO** - Include relevant keywords naturally, write compelling meta descriptions

## TOPIC AREAS
- Timebanking tips and success stories
- Skill-sharing guides and tutorials
- Community building and connection
- Sustainable living and local economy
- Member spotlights and achievements

Remember: You're writing for real neighbors who want to connect and help each other.
EOT;
    }

    private function getPageSystemPrompt(): string
    {
        return <<<'EOT'
You are a web content designer for NEXUS TimeBank, creating pages for a community time-exchange platform.

## YOUR MISSION
Generate clean, modern HTML content that's visually appealing and converts visitors into community members.

## DESIGN PRINCIPLES
1. **CLARITY** - Every section has a clear purpose and message
2. **SCANNABILITY** - Use headings, short paragraphs, bullet points
3. **ACTION-ORIENTED** - Include clear calls-to-action
4. **COMMUNITY-FOCUSED** - Emphasize connection, sharing, and mutual aid
5. **MOBILE-FIRST** - Use responsive-friendly layouts (flexbox)

## HTML GUIDELINES
- Use semantic HTML (section, article, h1-h3, p, ul, etc.)
- Include inline styles for spacing and alignment
- Use placeholder text like "[Button Text]" for CTAs
- Keep styles simple and modern (clean fonts, good spacing)
- Colors: Primary #6366f1, Success #10b981, Warning #f59e0b

## BRAND VOICE
- Warm and welcoming
- Community-focused
- Empowering and positive
- Simple and clear (no jargon)

Remember: These pages help build a community of neighbors helping neighbors.
EOT;
    }

    // =====================================================================
    // PRIVATE — Newsletter platform data helpers
    // =====================================================================

    /**
     * Get real platform data for newsletter content generation.
     */
    private function getNewsletterPlatformData(): array
    {
        $tenantId = $this->getTenantId();
        $tenant = TenantContext::get();
        $platformName = $tenant['name'] ?? 'NEXUS TimeBank';

        $recentOffers = [];
        $recentRequests = [];
        $upcomingEvents = [];
        $totalMembers = 0;
        $newMembersThisMonth = 0;
        $exchangesThisMonth = 0;
        $hoursExchangedThisMonth = 0;
        $activeGroups = [];

        try {
            $twoWeeksAgo = date('Y-m-d H:i:s', strtotime('-14 days'));
            $recentOffers = Listing::getRecent('offer', 5, $twoWeeksAgo) ?: [];
            $recentRequests = Listing::getRecent('request', 5, $twoWeeksAgo) ?: [];
        } catch (\Exception $e) {
            \Illuminate\Support\Facades\Log::warning("Newsletter AI: Error fetching listings - " . $e->getMessage());
        }

        try {
            // upcoming() is a query scope; tenant filter is applied by HasTenantScope
            // (== $tenantId here). Execute it (was returning an unexecuted Builder).
            $upcomingEvents = Event::upcoming()->limit(5)->get()->all();
        } catch (\Exception $e) {
            \Illuminate\Support\Facades\Log::warning("Newsletter AI: Error fetching events - " . $e->getMessage());
        }

        try {
            $totalMembers = User::count() ?: 0;
        } catch (\Exception $e) {
            \Illuminate\Support\Facades\Log::warning("Newsletter AI: Error fetching user count - " . $e->getMessage());
        }

        try {
            $result = DB::selectOne(
                "SELECT COUNT(*) as count FROM users WHERE tenant_id = ? AND created_at >= DATE_FORMAT(NOW(), '%Y-%m-01')",
                [$tenantId]
            );
            $newMembersThisMonth = (int) ($result->count ?? 0);
        } catch (\Exception $e) {
            \Illuminate\Support\Facades\Log::warning("Newsletter AI: Error fetching new members count - " . $e->getMessage());
        }

        try {
            $result = DB::selectOne(
                "SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as total_hours FROM transactions WHERE tenant_id = ? AND created_at >= DATE_FORMAT(NOW(), '%Y-%m-01')",
                [$tenantId]
            );
            $exchangesThisMonth = (int) ($result->count ?? 0);
            $hoursExchangedThisMonth = (float) ($result->total_hours ?? 0);
        } catch (\Exception $e) {
            \Illuminate\Support\Facades\Log::warning("Newsletter AI: Error fetching transactions - " . $e->getMessage());
        }

        try {
            $rows = DB::select(
                "SELECT name FROM `groups` WHERE tenant_id = ? AND visibility = 'public' ORDER BY created_at DESC LIMIT 3",
                [$tenantId]
            );
            $activeGroups = array_map(fn($r) => $r->name, $rows);
        } catch (\Exception $e) {
            \Illuminate\Support\Facades\Log::warning("Newsletter AI: Error fetching groups - " . $e->getMessage());
        }

        return [
            'platform_name' => $platformName,
            'total_members' => $totalMembers,
            'new_members_this_month' => $newMembersThisMonth,
            'exchanges_this_month' => $exchangesThisMonth,
            'hours_exchanged_this_month' => round($hoursExchangedThisMonth, 1),
            'recent_offers' => $recentOffers,
            'recent_requests' => $recentRequests,
            'upcoming_events' => $upcomingEvents,
            'active_groups' => $activeGroups,
        ];
    }

    /**
     * Format platform data as readable text for AI prompt.
     */
    private function formatPlatformDataForPrompt(array $data): string
    {
        $output = "## REAL DATA FROM {$data['platform_name']} DATABASE\n";
        $output .= "## USE ONLY THIS DATA - DO NOT ADD ANYTHING ELSE\n\n";

        $output .= "### Platform Statistics (REAL NUMBERS)\n";
        $output .= "- Total Members: {$data['total_members']}\n";
        $output .= "- New Members This Month: {$data['new_members_this_month']}\n";
        $output .= "- Exchanges This Month: {$data['exchanges_this_month']}\n";
        $output .= "- Hours Shared This Month: {$data['hours_exchanged_this_month']}\n\n";

        $offerCount = count($data['recent_offers'] ?? []);
        $output .= "### Recent Offers - COUNT: {$offerCount}\n";
        if ($offerCount > 0) {
            foreach ($data['recent_offers'] as $offer) {
                $title = htmlspecialchars($offer['title'] ?? 'Untitled');
                $name = htmlspecialchars($offer['user_name'] ?? __('emails.common.fallback_member_name'));
                $output .= "- \"{$title}\" offered by {$name}\n";
            }
        } else {
            $output .= "- (No recent offers - DO NOT INVENT ANY)\n";
        }
        $output .= "\n";

        $requestCount = count($data['recent_requests'] ?? []);
        $output .= "### Recent Requests - COUNT: {$requestCount}\n";
        if ($requestCount > 0) {
            foreach ($data['recent_requests'] as $request) {
                $title = htmlspecialchars($request['title'] ?? 'Untitled');
                $name = htmlspecialchars($request['user_name'] ?? __('emails.common.fallback_member_name'));
                $output .= "- \"{$title}\" requested by {$name}\n";
            }
        } else {
            $output .= "- (No recent requests - DO NOT INVENT ANY)\n";
        }
        $output .= "\n";

        $eventCount = count($data['upcoming_events'] ?? []);
        $output .= "### Upcoming Events - COUNT: {$eventCount}\n";
        if ($eventCount > 0) {
            foreach ($data['upcoming_events'] as $event) {
                $title = htmlspecialchars($event['title'] ?? 'Untitled');
                $date = \Carbon\Carbon::parse($event['start_time'] ?? 'now')
                    ->locale(\App\I18n\FormattingLocale::carbon())
                    ->isoFormat('dddd, LL');
                $organizer = htmlspecialchars($event['organizer_name'] ?? 'Community');
                $output .= "- \"{$title}\" on {$date}, hosted by {$organizer}\n";
            }
        } else {
            $output .= "- (No upcoming events - DO NOT INVENT ANY)\n";
        }
        $output .= "\n";

        $groupCount = count($data['active_groups'] ?? []);
        $output .= "### Active Groups - COUNT: {$groupCount}\n";
        if ($groupCount > 0) {
            foreach ($data['active_groups'] as $group) {
                $output .= "- {$group}\n";
            }
        } else {
            $output .= "- (No active groups to mention)\n";
        }
        $output .= "\n";

        $output .= "## END OF REAL DATA - ANYTHING NOT LISTED ABOVE IS FAKE\n\n";

        return $output;
    }
}
