<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

/**
 * Builds tenant-aware support context for the member AI assistant.
 *
 * This is intentionally retrieval-first: platform facts should come from the
 * tenant configuration and Knowledge Base, while the model translates that
 * source material into plain support guidance.
 */
class AiSupportContextService
{
    private const KB_LIMIT = 4;
    private const MAX_HISTORY_MESSAGES = 16;
    private const MAX_EXCERPT_LENGTH = 900;

    private const STOP_WORDS = [
        'about', 'after', 'again', 'also', 'and', 'any', 'are', 'can', 'cant',
        'could', 'does', 'for', 'from', 'get', 'had', 'has', 'have', 'help',
        'how', 'into', 'just', 'like', 'more', 'need', 'not', 'our', 'please',
        'that', 'the', 'their', 'then', 'there', 'they', 'this', 'use', 'using',
        'what', 'when', 'where', 'which', 'who', 'why', 'with', 'would', 'you',
        'your',
    ];

    private const SUPPORT_AREAS = [
        [
            'id' => 'timebanking_basics',
            'title' => 'Timebanking basics',
            'keywords' => ['timebank', 'timebanking', 'credit', 'credits', 'hour', 'hours', 'exchange'],
            'route' => '/help',
            'summary' => 'Timebanking is based on exchanging help using time credits. One hour of help is normally one time credit, regardless of the type of service.',
        ],
        [
            'id' => 'listings',
            'title' => 'Listings',
            'keywords' => ['listing', 'listings', 'offer', 'request', 'service', 'skill', 'skills'],
            'module' => 'listings',
            'route' => '/listings',
            'summary' => 'Listings are where members offer skills or request help. Signed-in members can usually create a listing from the listings area.',
        ],
        [
            'id' => 'wallet',
            'title' => 'Wallet',
            'keywords' => ['wallet', 'balance', 'transfer', 'pay', 'paid', 'payment', 'credits'],
            'module' => 'wallet',
            'route' => '/wallet',
            'summary' => 'The wallet shows time credit balance and transactions. Transfers should only be made when both members understand what exchange is being recorded.',
        ],
        [
            'id' => 'messages',
            'title' => 'Messages',
            'keywords' => ['message', 'messages', 'chat', 'conversation', 'contact', 'inbox'],
            'module' => 'messages',
            'feature' => 'direct_messaging',
            'route' => '/messages',
            'summary' => 'Messages let members discuss an exchange, event, or group activity. If direct messaging is disabled, members may need to contact an administrator.',
        ],
        [
            'id' => 'events',
            'title' => 'Events',
            'keywords' => ['event', 'events', 'rsvp', 'attend', 'attendance', 'waitlist'],
            'feature' => 'events',
            'route' => '/events',
            'summary' => 'Events can be browsed from the events area. If RSVP is available, members can register interest from the event details page.',
        ],
        [
            'id' => 'groups',
            'title' => 'Groups',
            'keywords' => ['group', 'groups', 'join', 'member', 'members', 'community'],
            'feature' => 'groups',
            'route' => '/groups',
            'summary' => 'Groups help members organize around shared interests or local activities. Some groups may require approval before a member can participate.',
        ],
        [
            'id' => 'profile_settings',
            'title' => 'Profile and settings',
            'keywords' => ['profile', 'settings', 'account', 'password', 'email', 'avatar', 'photo', 'language', 'notification'],
            'module' => 'settings',
            'route' => '/settings',
            'summary' => 'Settings has tabs for profile (including language and appearance), notifications, privacy and security.',
        ],
        [
            'id' => 'security_passkeys',
            'title' => 'Security and passkeys',
            'keywords' => ['passkey', 'passkeys', 'webauthn', 'biometric', 'windows hello', '2fa', 'totp', 'security'],
            'module' => 'settings',
            'route' => '/settings?tab=security',
            'summary' => 'Settings → Security has the password, two-step sign-in (an authenticator app with backup codes), passkeys if switched on, and the list of signed-in devices.',
        ],
        [
            'id' => 'volunteering',
            'title' => 'Volunteering',
            'keywords' => ['volunteer', 'volunteering', 'shift', 'shifts', 'opportunity', 'opportunities'],
            'feature' => 'volunteering',
            'route' => '/volunteering',
            'summary' => 'Volunteering surfaces opportunities and shifts where that feature is enabled for the community.',
        ],
        [
            'id' => 'knowledge_base',
            'title' => 'Knowledge Base',
            'keywords' => ['knowledge', 'article', 'articles', 'guide', 'guides', 'resource', 'resources', 'faq'],
            'feature' => 'resources',
            'route' => '/kb',
            'summary' => 'The Knowledge Base holds help articles published by the community admins.',
        ],
    ];

    /**
     * @return array{content: string, sources: array<int, array<string, mixed>>, source_count: int}
     */
    public function build(int $userId, string $message): array
    {
        try {
            $tenantId = (int) TenantContext::getId();
            $tenant = $this->tenantProfile($tenantId);
            $user = $this->userProfile($tenantId, $userId);
            // Only member help reaches the assistant. Timebank Ireland's
            // Knowledge Base held engineering reports written in March 2026;
            // every answer ended with links to them, and the model was reading
            // months-old internals as if they described the platform today
            // (18 Nov 2026). A technical article is now neither shown to the
            // member nor given to the model.
            $articles = array_values(array_filter(
                $this->searchKnowledgeBase($tenantId, $message),
                fn (array $article) => ($article['audience'] ?? '') !== 'technical_reference'
            ));
            $areas = $this->matchSupportAreas($message, $tenant['features'], $tenant['modules']);

            $content = $this->composeContext($tenant, $user, $articles, $areas);

            $memberSources = array_values(array_map(fn (array $article) => $article['source'], $articles));

            return [
                'content' => $content,
                'sources' => $memberSources,
                'source_count' => count($memberSources),
            ];
        } catch (\Throwable $e) {
            Log::warning('AiSupportContextService::build failed', [
                'error' => $e->getMessage(),
                'tenant_id' => TenantContext::getId(),
                'user_id' => $userId,
            ]);

            return [
                'content' => $this->fallbackContext(),
                'sources' => [],
                'source_count' => 0,
            ];
        }
    }

    /**
     * @return array<int, object>
     */
    public function recentConversationHistory(int $conversationId): array
    {
        $rows = DB::select(
            'SELECT role, content FROM ai_messages
             WHERE conversation_id = ?
             ORDER BY created_at DESC, id DESC
             LIMIT ?',
            [$conversationId, self::MAX_HISTORY_MESSAGES]
        );

        return array_reverse($rows);
    }

    /**
     * @return array<string, mixed>
     */
    private function tenantProfile(int $tenantId): array
    {
        $tenant = TenantContext::get() ?: [];
        $features = $this->decodeJsonMap($tenant['features'] ?? null);
        $configuration = $this->decodeJsonMap($tenant['configuration'] ?? null);
        $modules = is_array($configuration['modules'] ?? null) ? $configuration['modules'] : null;

        return [
            'id' => $tenantId,
            'name' => $tenant['name'] ?? 'this community',
            'slug' => $tenant['slug'] ?? null,
            'category' => $tenant['tenant_category'] ?? 'community',
            'features' => TenantFeatureConfig::mergeFeatures($features),
            'modules' => TenantFeatureConfig::mergeModules($modules),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function userProfile(int $tenantId, int $userId): array
    {
        $user = DB::table('users')
            ->where('id', $userId)
            ->where('tenant_id', $tenantId)
            ->select('id', 'role', 'profile_type', 'preferred_language', 'onboarding_completed', 'is_approved')
            ->first();

        if (!$user) {
            return [
                'role' => 'member',
                'profile_type' => 'individual',
                'preferred_language' => null,
                'onboarding_completed' => null,
                'is_approved' => null,
            ];
        }

        return [
            'role' => $user->role ?? 'member',
            'profile_type' => $user->profile_type ?? 'individual',
            'preferred_language' => $user->preferred_language ?? null,
            'onboarding_completed' => isset($user->onboarding_completed) ? (bool) $user->onboarding_completed : null,
            'is_approved' => isset($user->is_approved) ? (bool) $user->is_approved : null,
        ];
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    private function searchKnowledgeBase(int $tenantId, string $message): array
    {
        $terms = $this->extractTerms($message);
        if ($terms === []) {
            return [];
        }

        $query = DB::table('knowledge_base_articles as a')
            ->leftJoin('categories as c', 'a.category_id', '=', 'c.id')
            ->where('a.tenant_id', $tenantId)
            ->where('a.is_published', true)
            ->where(function ($q) use ($terms) {
                foreach ($terms as $term) {
                    $like = '%' . $term . '%';
                    $q->orWhere('a.title', 'LIKE', $like)
                        ->orWhere('a.content', 'LIKE', $like);
                }
            });

        $scoreParts = [];
        $bindings = [];
        foreach ($terms as $term) {
            $like = '%' . $term . '%';
            $scoreParts[] = 'CASE WHEN a.title LIKE ? THEN 8 ELSE 0 END';
            $bindings[] = $like;
            $scoreParts[] = 'CASE WHEN a.content LIKE ? THEN 2 ELSE 0 END';
            $bindings[] = $like;
        }

        $rows = $query
            ->orderByRaw(implode(' + ', $scoreParts) . ' DESC', $bindings)
            ->orderByDesc('a.helpful_yes')
            ->orderByDesc('a.views_count')
            ->orderByDesc('a.updated_at')
            ->limit(self::KB_LIMIT)
            ->select(
                'a.id',
                'a.title',
                'a.slug',
                'a.content',
                'a.content_type',
                'a.views_count',
                'a.helpful_yes',
                'a.helpful_no',
                'c.name as category_name'
            )
            ->get();

        return $rows->map(function ($row) {
            $plainText = $this->toPlainText($row->content ?? '');
            $audience = $this->inferAudience($row->title ?? '', $plainText);
            $url = TenantContext::getSlugPrefix() . '/kb/' . (int) $row->id;

            return [
                'id' => (int) $row->id,
                'title' => $row->title,
                'category' => $row->category_name,
                'audience' => $audience,
                'excerpt' => Str::limit($plainText, self::MAX_EXCERPT_LENGTH),
                'source' => [
                    'type' => 'knowledge_base',
                    'id' => (int) $row->id,
                    'title' => $row->title,
                    'url' => $url,
                    'audience' => $audience,
                ],
            ];
        })->all();
    }

    /**
     * @param array<string, bool> $features
     * @param array<string, bool> $modules
     * @return array<int, array<string, mixed>>
     */
    private function matchSupportAreas(string $message, array $features, array $modules): array
    {
        $haystack = mb_strtolower($message);
        $matches = [];

        foreach (self::SUPPORT_AREAS as $area) {
            foreach ($area['keywords'] as $keyword) {
                if (mb_stripos($haystack, $keyword) === false) {
                    continue;
                }

                $enabled = true;
                $disabledBy = null;

                if (!empty($area['module']) && empty($modules[$area['module']])) {
                    $enabled = false;
                    $disabledBy = 'module:' . $area['module'];
                }

                if (!empty($area['feature']) && empty($features[$area['feature']])) {
                    $enabled = false;
                    $disabledBy = 'feature:' . $area['feature'];
                }

                $matches[] = array_merge($area, [
                    'enabled' => $enabled,
                    'disabled_by' => $disabledBy,
                    'url' => TenantContext::getSlugPrefix() . $area['route'],
                ]);
                break;
            }
        }

        return array_slice($matches, 0, 5);
    }

    /**
     * @param array<string, mixed> $tenant
     * @param array<string, mixed> $user
     * @param array<int, array<string, mixed>> $articles
     * @param array<int, array<string, mixed>> $areas
     */
    private function composeContext(array $tenant, array $user, array $articles, array $areas): string
    {
        // Wording re-checked 18 Nov 2026 after the owner reported false answers:
        // the model must not fill gaps with invented paths, numbers or rules.
        $lines = [
            '# Community Support Context',
            '',
            'You are helping a member or administrator of this timebanking community. The site hosts many separate communities; you only know about this one.',
            'Answer from the guides, help articles and tool results provided. Only state a menu path, number, time limit, permission, privacy rule or automatic behaviour if it appears there; otherwise say you are not sure and suggest the Help Centre or the community\'s team.',
            'Use plain, member-friendly language. Never mention internal names (the feature keys below, database or code names, "tenant", "API", "module").',
            'If a feature is switched off in this community, do not tell the user they can use it; say an admin of this community would need to switch it on.',
            'For safeguarding, account security, billing, legal or data-deletion concerns, give calm, short guidance and suggest contacting this community\'s team through the Contact us link in the footer. For immediate danger, tell the user to contact local emergency services.',
            'When naming members, use first names only.',
            'Keep answers short and step by step. Ask at most one clarifying question.',
            '',
            '## Community',
            '- Name: ' . $tenant['name'],
            '- Category: ' . $tenant['category'],
            '- Switched on: ' . $this->enabledKeys($tenant['modules']) . ', ' . $this->enabledKeys($tenant['features']),
            '- Switched off: ' . $this->disabledKeys($tenant['modules']) . ', ' . $this->disabledKeys($tenant['features']),
            '',
            '## User Context',
            '- Role: ' . ($user['role'] ?? 'member'),
            '- Profile type: ' . ($user['profile_type'] ?? 'individual'),
            '- Preferred language: ' . (($user['preferred_language'] ?? null) ?: 'not set'),
            '- Onboarding completed: ' . $this->boolLabel($user['onboarding_completed'] ?? null),
            '- Approved: ' . $this->boolLabel($user['is_approved'] ?? null),
        ];

        if ($areas !== []) {
            $lines[] = '';
            $lines[] = '## Relevant Platform Areas';
            foreach ($areas as $area) {
                $status = $area['enabled'] ? 'switched on' : 'switched off in this community';
                $lines[] = '- ' . $area['title'] . ' (' . $status . ', route: ' . $area['url'] . '): ' . $area['summary'];
            }
        }

        $lines[] = '';
        $lines[] = '## Retrieved Knowledge Base Articles';
        if ($articles === []) {
            $lines[] = 'No matching published Knowledge Base article was found for this question.';
        } else {
            foreach ($articles as $article) {
                $lines[] = '[KB:' . $article['id'] . '] ' . $article['title'];
                $lines[] = '- Audience signal: ' . $article['audience'];
                if (!empty($article['category'])) {
                    $lines[] = '- Category: ' . $article['category'];
                }
                $lines[] = '- Excerpt: ' . $article['excerpt'];
            }
        }

        return implode("\n", $lines);
    }

    private function fallbackContext(): string
    {
        return implode("\n", [
            '# Community Support Context',
            'Support context retrieval failed. Do not guess how this community\'s site works: say you are not sure, and suggest the Help Centre or the community\'s team (Contact us link in the footer).',
        ]);
    }

    /**
     * @return array<int, string>
     */
    private function extractTerms(string $message): array
    {
        $words = preg_split('/[^\p{L}\p{N}_]+/u', mb_strtolower($message), -1, PREG_SPLIT_NO_EMPTY);
        if (!is_array($words)) {
            return [];
        }

        $terms = [];
        foreach ($words as $word) {
            $word = trim($word);
            if (mb_strlen($word) < 3 || in_array($word, self::STOP_WORDS, true)) {
                continue;
            }
            $terms[$word] = true;
        }

        return array_slice(array_keys($terms), 0, 8);
    }

    private function toPlainText(string $content): string
    {
        $text = html_entity_decode(strip_tags($content), ENT_QUOTES | ENT_HTML5, 'UTF-8');
        $text = preg_replace('/\[(.*?)\]\((.*?)\)/u', '$1', $text) ?? $text;
        $text = preg_replace('/[`*_>#|~]+/u', ' ', $text) ?? $text;
        $text = preg_replace('/\s+/u', ' ', $text) ?? $text;

        return trim($text);
    }

    private function inferAudience(string $title, string $plainText): string
    {
        $haystack = mb_strtolower($title . ' ' . $plainText);
        $technicalSignals = [
            'api', 'artisan', 'controller', 'database', 'docker', 'endpoint',
            'http', 'json', 'laravel', 'migration', 'nginx', 'opcache', 'php',
            'query', 'redis', 'route', 'schema', 'sql', 'tenant_id', 'typescript',
        ];

        $score = 0;
        foreach ($technicalSignals as $signal) {
            if (str_contains($haystack, $signal)) {
                $score++;
            }
        }

        return $score >= 2 ? 'technical_reference' : 'member_support';
    }

    /**
     * @return array<string, mixed>|null
     */
    private function decodeJsonMap($value): ?array
    {
        if (is_array($value)) {
            return $value;
        }
        if (!is_string($value) || trim($value) === '') {
            return null;
        }

        $decoded = json_decode($value, true);
        return is_array($decoded) ? $decoded : null;
    }

    /**
     * @param array<string, bool> $map
     */
    private function enabledKeys(array $map): string
    {
        $keys = array_keys(array_filter($map));
        return $keys === [] ? 'none' : implode(', ', $keys);
    }

    /**
     * @param array<string, bool> $map
     */
    private function disabledKeys(array $map): string
    {
        $keys = array_keys(array_filter($map, fn ($enabled) => !$enabled));
        return $keys === [] ? 'none' : implode(', ', $keys);
    }

    private function boolLabel($value): string
    {
        if ($value === null) {
            return 'unknown';
        }

        return $value ? 'yes' : 'no';
    }
}
