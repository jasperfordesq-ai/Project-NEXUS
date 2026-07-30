# AI Chat / Assistant Module

Audience: maintainers and contributors working on the in-platform AI assistant, its provider abstraction, tool/function-calling layer, content generation, or the privacy boundary with external AI providers.

Last reviewed: 2026-07-14

## Purpose

The AI assistant is an in-platform helper that answers questions about the platform and the member's own community. It can explain features, walk through workflows, draft listings/events/messages/bios, and — through function-calling **tools** — search live, tenant-scoped data (listings, members, events, jobs, marketplace, knowledge base) and report the member's own wallet balance. A separate set of admin-only "content generation" endpoints reuse the same provider layer to draft newsletters, blog posts, and CMS page sections.

Two surfaces consume the same backend:

- **React frontend** (`react-frontend/src/pages/chat/AiChatPage.tsx`) — the primary tool-augmented chat UI; renders structured result cards beside the assistant's text reply.
- **Accessible (GOV.UK, no-JS) frontend** (`app/Http/Controllers/GovukAlpha/Concerns/AiChatParity.php`, view `accessible-frontend/views/ai-chat.blade.php`) — an HTML-first, single-turn-per-reload equivalent. It calls the same `AIServiceFactory` synchronously **without** tool-calling orchestration or streaming, then re-renders the full thread. Degraded but fully functional and screen-reader friendly.

## Feature gates and tenant scoping

| Flag | Default | Gates |
|------|---------|-------|
| `ai_chat` | ON | The member chat assistant (React route `/chat` via `FeatureGate feature="ai_chat"`; accessible route guarded by `abort_unless(TenantContext::hasFeature('ai_chat'), 403)`). |
| `ai_agents` | OFF | A **separate** admin "autonomous agents" subsystem (`AgentAdminController`, `app/Services/Agent/*`) — not the chat assistant. Mentioned here only to avoid confusion; out of scope for this guide. |

Defaults live in `app/Services/TenantFeatureConfig.php`.

Beyond the feature flag, two layers of enablement apply at request time (see `AIServiceFactory`):

- `AIServiceFactory::isEnabled()` — per-tenant `ai_enabled` DB setting (falls back to config).
- `AIServiceFactory::isFeatureEnabled('content_generation')` — gates the `/ai/generate/*` endpoints; returns 403 `FEATURE_DISABLED` when off.

Every query in this module is scoped to `TenantContext::getId()`. Conversations and messages are additionally scoped to the calling `user_id`. Tools throw if invoked without tenant context (`AbstractTool::tenantId()`).

## Routes, controllers, services

- Routes: `routes/api.php` (search for `/ai/chat`, `/ai/conversations`, `/ai/providers`, `/ai/generate/`). All sit inside the authenticated (`auth:sanctum`) group. Endpoint shapes are defined there and in the OpenAPI spec rather than duplicated here.
- Controller: `app/Http/Controllers/Api/AiChatController.php` — chat, history, conversation CRUD, provider listing, limits, content generation.
- Accessible controller trait: `app/Http/Controllers/GovukAlpha/Concerns/AiChatParity.php`.
- Admin AI config UI: `react-frontend/src/admin/modules/advanced/AiSettings.tsx`.

Key services under `app/Services/AI/`:

| Service | Role |
|---------|------|
| `AIServiceFactory` | Static factory + dispatcher. Resolves the active provider, applies DB-over-config precedence, exposes `chatWithFallback()`, `getSystemPrompt()`, enablement checks. |
| `Contracts/AIProviderInterface` | The pluggable provider contract (`chat`, `complete`, `embed`, `streamChat`, `getModels`, `isConfigured`, `testConnection`, …). |
| `Providers/*` | `AnthropicProvider`, `GeminiProvider`, `OpenAIProvider`, `OllamaProvider` (+ `BaseProvider`). |
| `Tools/ToolRegistry` + `Tools/*` | Function-calling tool layer (below). |
| `AiModuleDocsService` | Admin-editable, per-tenant "how each module works" grounding docs injected into the system prompt. |
| `AiSuggestedPromptsService` | Empty-state starter prompts tailored to enabled modules (no model call). |
| `AiUserMemoryService` | Compact "who am I" snapshot injected as system context. |
| `AiTurnTraceService` | Per-turn cost/quality tracing + thumbs feedback + admin metrics. |
| `App\Services\AiSupportContextService` | Builds support context + bounded recent conversation history. |

## The chat turn (tool-augmented loop)

`AiChatController::chat()` (POST `/ai/chat`) builds the message stack, then runs a bounded tool-calling loop:

1. System messages assembled in order: tenant system prompt (`AIServiceFactory::getSystemPrompt()`), tool-usage guidance, support context, optional user-memory block, optional matched module-docs block.
2. The last ~12 conversation turns are appended (older turns are trimmed, not yet summarised).
3. The model is called via `AIServiceFactory::chatWithFallback()` with `tools` (OpenAI-style schemas from `ToolRegistry::openAiSchemasFor($userId)`) and `tool_choice: auto`.
4. If the model returns tool calls, each is executed via `ToolRegistry::execute()`, the result is appended as a `role: tool` message, and the loop repeats — up to `MAX_TOOL_HOPS = 5`.
5. After the hop limit, one final tool-less call forces a text answer.
6. Both user and assistant messages are persisted; a trace row is recorded; the response includes `tool_invocations` (so the UI can render result cards), token counts, provider/model, and a `trace_id`.

Temperature is low (0.2) for the assistant; tokens are capped (1200) per call.

### Streaming

There is no working SSE stream today. `POST /ai/chat/stream` returns `501 NOT_IMPLEMENTED`. The React UI uses the non-streaming `/ai/chat` endpoint. The accessible frontend is single-turn-per-reload by design. (`AIProviderInterface::streamChat()` exists and providers implement it, but no live endpoint currently exposes it.)

## Provider abstraction

`AIServiceFactory::createProvider()` maps a provider ID to a concrete class:

- `gemini` → `GeminiProvider` (default provider; free-tier)
- `openai` → `OpenAIProvider`
- `anthropic` → `AnthropicProvider`
- `ollama` → `OllamaProvider` (self-hosted; no API key required)

**Configuration precedence:** database settings (`AiSettings::getAllForTenant`) are the real source of configuration. A tenant admin sets the provider, model, and API key in Admin → AI Settings. `AIServiceFactory::getConfig()` probes an optional **`app/Config/ai.php`** (not Laravel's `config/ai.php`) — `$configPath = dirname(__DIR__, 2) . '/Config/ai.php'`. That file is not tracked (`app/Config/` holds only `ApiDeprecation.php`), so the factory falls back to a hardcoded default array (`enabled => false`, default provider `gemini`). The default provider is `AiSettings::get($tenantId, 'ai_provider')` if set, else that hardcoded `gemini` default. Cloud providers without an API key throw a clear "not configured" error (Ollama is exempt).

**Automatic fallback:** `chatWithFallback()` tries the preferred provider, then other *configured* providers (free-tier ones prioritised), retrying on **any** provider error — rate-limit/quota (`429`), auth (`401`/`403`), and server (`5xx`) errors are handled explicitly, and all other exceptions also fall through to the next configured provider. The response carries `provider` and `used_fallback`.

**Adding a provider:** implement `AIProviderInterface`, add a class under `Providers/`, and add a `match` arm in `AIServiceFactory::createProvider()` + a config entry. Anthropic's wire translation (`translateMessagesForAnthropic`) shows how to map the provider-neutral message/tool format onto a provider that doesn't speak OpenAI's schema natively.

## Tools / function-calling

Registered in `ToolRegistry::defaultTools()`; each implements `ToolInterface` (most extend `AbstractTool`).

| Tool | Purpose | Availability |
|------|---------|--------------|
| `search_listings` | Offers/requests (time-credit services). | Always |
| `search_members` | Member directory. | Always |
| `search_kb` | Knowledge-base / help articles. | Always |
| `search_events` | Upcoming events. | Only when `events` module enabled |
| `search_jobs` | Job vacancies. | Only when `job_vacancies` module enabled |
| `search_marketplace` | Marketplace items. | Only when `marketplace` module enabled |
| `get_my_wallet_balance` | The **calling user's own** balance + 30-day transaction count. | Only when `wallet` module enabled |
| `semantic_search` | Embedding/synonym search fallback for vague queries. | Always |

Tool prompt guidance steers the model to prefer the specific keyword tools and fall back to `semantic_search` only for vague queries. `availableFor($userId)` filters by per-tool `isAvailable()` before schemas are exposed, so disabled-module tools are never offered to the model.

**Tool safety invariants:**

- Every tool resolves `tenant_id` from `TenantContext` and scopes its query; `AbstractTool::tenantId()` throws if tenant context is missing.
- Result-set tools enforce content visibility — e.g. `SearchListingsTool` filters `status = active` and `moderation_status` null-or-`approved`, and bounds `limit` to 1–8.
- `get_my_wallet_balance` is hard-scoped to the calling `user_id` (and never another member); its description tells the model to call it only for the user's own balance.
- Tool execution errors are caught in `ToolRegistry::execute()` and returned as a structured `{ ok: false, error }` envelope so the model can recover rather than crashing the turn.

## Privacy & safety — what leaves the platform

This is the sensitive boundary; treat changes here with care.

**What is sent to the external AI provider on each chat turn:**

- The tenant system prompt and tool-usage guidance.
- The user's typed message and the last ~12 turns of *that user's own* conversation.
- The **user-memory block** (`AiUserMemoryService::buildPrompt`): a service-selected account/profile snapshot — first/last name or organisation name, role, profile type, preferred language, location, skills, tagline, and time-credit balance (flagged "do not mention unless asked"), plus up to 3 of the user's own recent active listing titles. These are not limited to fields independently proven public by this service. **No email, phone, or date of birth.** Tenant-scoped.
- Matched **module-docs** grounding text (admin-authored, per-tenant, public-facing how-to content — not member PII).
- **Tool results**, which are themselves tenant-scoped and visibility-filtered (active/approved listings, etc.). The wallet tool returns only the caller's own balance and a count.

**Where the data goes:** to whichever provider the tenant admin configured (Gemini / OpenAI / Anthropic), or to a self-hosted **Ollama** endpoint if the tenant prefers data not to leave their own infrastructure. There is no platform-default provider that bypasses tenant configuration — a tenant with no key configured simply gets the unavailable fallback.

**What is NOT sent:** other members' private messages, other members' PII beyond what their public directory entry already exposes, payment/card data (the platform processes none), or cross-tenant data.

**Conversation privacy:** conversation and message APIs are private to the member. Separately, every turn is copied into `ai_turn_traces`: user text is truncated to 4,000 characters and assistant text to 8,000. Admin metrics are aggregated, but down-voted turns expose 300-character user and 400-character assistant excerpts, plus the member's feedback note, for quality triage. Account for this operational copy in data-retention/GDPR work.

## Turn tracing & feedback

`AiTurnTraceService` writes one `ai_turn_traces` row per turn: tenant/user/conversation/message ids, text truncated to the limits above, provider, model, token counts, best-effort `cost_usd` (static `PRICING` map — update when model prices change), latency, compacted tool-call summary, and any error. Tool result bodies are not retained in this trace; only tool name, success, result count, and a 160-character summary are stored. `POST /ai/chat/feedback` records thumbs up/down (by `trace_id` or `message_id`). `metricsFor()` powers the admin AI analytics view.

## Rate limiting & quotas

- Per-endpoint throttles in the controller via `$this->rateLimit(...)`: chat `30/60s`, feedback `60/60s`, stream `20/60s` (per the controller).
- Content-generation endpoints additionally enforce per-user daily/monthly quotas via `AiUserLimit::canMakeRequest()` / `incrementUsage()` (limits configurable per tenant through `AIServiceFactory::getLimitsConfig()`), returning `429 RATE_LIMIT` when exceeded. Usage is logged to `AiUsage`.

## Content generation endpoints

`POST /ai/generate/{listing,event,message,bio}` (member-facing) and `/ai/generate/{newsletter,blog,page}` (admin-facing, `requireAdmin()`). All gate on `content_generation`, check `AiUserLimit`, build a structured prompt, call the active provider directly (not the tool loop), and convert provider exceptions to friendly messages via `getFriendlyAiErrorMessage()`. The newsletter prompt is grounded in real platform data and contains explicit "never invent names/listings/events/stats" guardrails.

## Data model (tables)

| Table | Holds |
|-------|-------|
| `ai_conversations` | One row per chat thread (`tenant_id`, `user_id`, `title`, timestamps). |
| `ai_messages` | Messages within a conversation (`role`, `content`, `tokens_used`, `model`). |
| `ai_turn_traces` | Per-turn cost/quality trace + feedback. |
| `ai_module_docs` | Admin-editable per-tenant grounding docs (`module_slug`, `title`, `body`, `keywords`, `is_active`). |

Settings/usage models: `AiSettings` (per-tenant provider/key/model/prompt/limits), `AiUserLimit` (per-user quota), `AiUsage` (usage log). `AiModuleDocsService::seedDefaultsForTenant()` seeds a comprehensive default doc set (idempotent — never overwrites admin edits).

## Failure modes & recovery

| Failure | Behaviour | Recovery |
|---------|-----------|----------|
| Provider down / errors mid-turn | `chatWithFallback()` retries other configured providers (free-tier first); if all fail the controller catches it, returns a localized "not available" message, and records the error on the trace. | Restore the provider, or configure a second provider so fallback has somewhere to go. Check `ai_turn_traces.error`. |
| No API key configured | `getProviderConfig()` throws "not configured"; chat returns the unavailable fallback. | Set the provider key in Admin → AI Settings (DB overrides config). |
| `content_generation` disabled | `/ai/generate/*` returns `403 FEATURE_DISABLED`. | Enable the feature for the tenant. |
| Per-user quota exceeded | `429 RATE_LIMIT`. | Wait for the daily/monthly window, or raise the tenant limit. |
| `ai_module_docs` table missing (migration pending) | `AiModuleDocsService::findRelevant()` fails soft and returns `[]`; chat still works without injected docs. | Run migrations. |
| Hit `MAX_TOOL_HOPS` | One final tool-less call forces a text answer. | Expected behaviour; no action. |
| Tool execution error | Returned as a structured error envelope; the model recovers. | Inspect logs (`AI tool execution failed`). |

## Tests

```bash
# PHP — run from repo root
vendor/bin/phpunit --filter=AiChatControllerTest
vendor/bin/phpunit --filter=AiChatParityTest        # accessible (no-JS) variant

# React — run from react-frontend/
npm test -- AiChatPage
```

Key regression tests:

- `tests/Laravel/Feature/Controllers/AiChatControllerTest.php` — chat/history/conversation/provider endpoints.
- `tests/Laravel/Feature/GovukAlpha/AiChatParityTest.php` — accessible-frontend chat parity, including the `ai_chat` feature gate and ownership scoping.
- `react-frontend/src/pages/chat/AiChatPage.test.tsx` — feature-gated unavailable state and chat UI.
