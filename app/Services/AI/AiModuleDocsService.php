<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services\AI;

use App\Core\TenantContext;
use Illuminate\Support\Facades\DB;

/**
 * Admin-editable, per-tenant "how each module works" documentation.
 *
 * Each row describes one platform area (listings, wallet, events, …) in
 * plain language and lists trigger keywords. When the user's message
 * contains any of a doc's keywords (or its slug), that doc's body is
 * appended to the AI chat system prompt as grounding.
 *
 * This supersedes the hardcoded SUPPORT_AREAS map in AiSupportContextService
 * — once an admin writes a custom doc for a slug, that text takes precedence
 * over any built-in summary.
 */
class AiModuleDocsService
{
    private const MAX_INJECTED = 4;
    public const MAX_BODY_INJECT_CHARS = 2400; // was 1200, which cut the safety guide short (18 Nov 2026)

    /**
     * The community switches each built-in guide depends on (all must be on).
     * A guide for a switched-off area is replaced in the prompt by a plain
     * "not available here" note, so the assistant never walks a member
     * through something their community does not offer (18 Nov 2026).
     *
     * @var array<string, array<int, array{0: 'feature'|'module', 1: string}>>
     */
    private const SWITCHES_FOR_SLUG = [
        'listings' => [['module', 'listings']],
        'wallet' => [['module', 'wallet']],
        'messages' => [['module', 'messages']],
        'feed' => [['module', 'feed']],
        'dashboard' => [['module', 'dashboard']],
        'profile' => [['module', 'profile']],
        'notifications' => [['module', 'notifications']],
        'settings' => [['module', 'settings']],
        'events' => [['feature', 'events']],
        'groups' => [['feature', 'groups']],
        'volunteering' => [['feature', 'volunteering']],
        'jobs' => [['feature', 'job_vacancies']],
        'marketplace' => [['feature', 'marketplace']],
        'blog' => [['feature', 'blog']],
        'resources' => [['feature', 'resources']],
        'polls' => [['feature', 'polls']],
        'ideation' => [['feature', 'ideation_challenges']],
        'organisations' => [['feature', 'volunteering'], ['feature', 'organisations']],
        'group_exchanges' => [['feature', 'group_exchanges']],
        'federation' => [['feature', 'federation']],
        'gamification' => [['feature', 'gamification']],
        'goals' => [['feature', 'goals']],
        'connections' => [['feature', 'connections']],
        'reviews' => [['feature', 'reviews']],
        'search' => [['feature', 'search']],
        'newsletter' => [['feature', 'newsletter']],
    ];

    /**
     * Built-in guides that are never given to members. Caring Community is an
     * unfinished module that must not be used or referenced (owner, 26 Oct
     * 2026). Its text stays in defaultSeed() only because the 26 Oct 2026
     * correction migration reads it; it is never seeded, and existing copies
     * are switched off.
     */
    public const RETIRED_SLUGS = ['caring_community'];

    /**
     * Return the docs that should be injected into the prompt for this
     * message. Match is case-insensitive substring against the doc's
     * keywords list (and the module slug as a fallback keyword).
     *
     * @return array<int, array<string, mixed>>
     */
    public function findRelevant(int $tenantId, string $message): array
    {
        $haystack = mb_strtolower($message);

        try {
            $docs = DB::table('ai_module_docs')
                ->where('tenant_id', $tenantId)
                ->where('is_active', true)
                ->orderBy('module_slug')
                ->get(['id', 'module_slug', 'title', 'body', 'keywords']);
        } catch (\Throwable $e) {
            // Table may not exist yet (migration not run). Fail soft — the
            // chat still works without injected module docs.
            \Illuminate\Support\Facades\Log::info('AiModuleDocsService: table query failed (migration pending?): ' . $e->getMessage());
            return [];
        }

        // Score every doc by (a) number of keyword hits and (b) total length
        // of matched keywords (longer matches like "how does the platform work"
        // outrank single-word hits like "platform"). Top-N by score wins so
        // the AI always gets the most relevant grounding regardless of insertion
        // order or alphabetical slug.
        $scored = [];
        foreach ($docs as $doc) {
            $keywords = $this->decodeKeywords($doc->keywords);
            if ($keywords === []) {
                $keywords = [$doc->module_slug];
            }
            $hits = 0;
            $matchedLen = 0;
            $firstKeyword = null;
            foreach ($keywords as $keyword) {
                $keyword = trim(mb_strtolower((string) $keyword));
                if ($keyword === '') {
                    continue;
                }
                if (mb_stripos($haystack, $keyword) !== false) {
                    $hits++;
                    $matchedLen += mb_strlen($keyword);
                    if ($firstKeyword === null) {
                        $firstKeyword = $keyword;
                    }
                }
            }
            if ($hits === 0) {
                continue;
            }
            $scored[] = [
                'score' => ($hits * 1000) + $matchedLen,
                'doc' => [
                    'slug' => (string) $doc->module_slug,
                    'title' => (string) $doc->title,
                    'body' => mb_substr((string) $doc->body, 0, self::MAX_BODY_INJECT_CHARS),
                    'matched_keyword' => $firstKeyword,
                ],
            ];
        }

        usort($scored, fn ($a, $b) => $b['score'] <=> $a['score']);
        return array_map(fn ($row) => $row['doc'], array_slice($scored, 0, self::MAX_INJECTED));
    }

    /**
     * Render matched docs as a Markdown section to append to the system
     * prompt. Empty string if no matches.
     */
    public function renderForPrompt(int $tenantId, string $message): string
    {
        $matched = $this->findRelevant($tenantId, $message);
        if ($matched === []) {
            return '';
        }
        $lines = ['', '## Admin Module Docs (canonical, prefer these over your training data)'];
        foreach ($matched as $doc) {
            $lines[] = '';
            $lines[] = '### ' . $doc['title'] . ' (' . $doc['slug'] . ')';
            $lines[] = $this->isSwitchedOff($tenantId, $doc['slug'])
                ? 'This community has NOT switched this on, so members cannot use it here. Say so plainly, do not describe how it works, and suggest asking a community administrator if they would like it.'
                : $doc['body'];
        }
        return implode("\n", $lines);
    }

    /**
     * Whether the community has switched off what this guide describes.
     * Only answerable for the community currently in context; any other
     * tenant id is left ungated rather than guessed.
     */
    private function isSwitchedOff(int $tenantId, string $slug): bool
    {
        $switches = self::SWITCHES_FOR_SLUG[$slug] ?? [];
        if ($switches === [] || (int) TenantContext::getId() !== $tenantId) {
            return false;
        }
        foreach ($switches as [$type, $key]) {
            $on = $type === 'module' ? TenantContext::hasModule($key) : TenantContext::hasFeature($key);
            if (! $on) {
                return true;
            }
        }
        return false;
    }

    /**
     * Convenience for the admin API list endpoint.
     * @return array<int, object>
     */
    public function listForTenant(int $tenantId): array
    {
        $defaults = self::defaultSeed();

        return DB::table('ai_module_docs')
            ->where('tenant_id', $tenantId)
            ->orderBy('module_slug')
            ->get(['id', 'module_slug', 'title', 'body', 'keywords', 'is_active', 'updated_at'])
            ->map(function ($row) use ($defaults) {
                $row->keywords = $this->decodeKeywords($row->keywords);
                $row->is_active = (bool) $row->is_active;
                $slug = (string) $row->module_slug;
                $default = $defaults[$slug] ?? null;
                $row->default_title_code = is_array($default)
                    && hash_equals((string) ($default['title'] ?? ''), (string) $row->title)
                        ? $slug
                        : null;
                return $row;
            })
            ->all();
    }

    public function upsert(int $tenantId, int $userId, array $input): array
    {
        $slug = trim((string) ($input['module_slug'] ?? ''));
        $title = trim((string) ($input['title'] ?? ''));
        $body = trim((string) ($input['body'] ?? ''));
        $keywords = is_array($input['keywords'] ?? null)
            ? array_values(array_filter(array_map('trim', $input['keywords'])))
            : [];
        $isActive = (bool) ($input['is_active'] ?? true);

        if ($slug === '' || $title === '' || $body === '') {
            throw new \InvalidArgumentException('module_slug, title, and body are required');
        }
        if (!preg_match('/^[a-z0-9_\-]{1,64}$/', $slug)) {
            throw new \InvalidArgumentException('module_slug must be 1-64 chars, lowercase letters, numbers, underscores or dashes');
        }

        $existing = DB::table('ai_module_docs')
            ->where('tenant_id', $tenantId)
            ->where('module_slug', $slug)
            ->first('id');

        $payload = [
            'tenant_id' => $tenantId,
            'module_slug' => $slug,
            'title' => $title,
            'body' => $body,
            'keywords' => json_encode($keywords),
            'is_active' => $isActive ? 1 : 0,
        ];

        if ($existing) {
            DB::table('ai_module_docs')->where('id', $existing->id)->update($payload);
            $id = (int) $existing->id;
        } else {
            $payload['created_by'] = $userId;
            $id = (int) DB::table('ai_module_docs')->insertGetId($payload);
        }

        return $this->getById($tenantId, $id);
    }

    public function delete(int $tenantId, int $id): bool
    {
        return DB::table('ai_module_docs')
            ->where('tenant_id', $tenantId)
            ->where('id', $id)
            ->delete() > 0;
    }

    public function getById(int $tenantId, int $id): array
    {
        $row = DB::table('ai_module_docs')
            ->where('tenant_id', $tenantId)
            ->where('id', $id)
            ->first();
        if (!$row) {
            throw new \RuntimeException('Doc not found');
        }
        $row->keywords = $this->decodeKeywords($row->keywords);
        $row->is_active = (bool) $row->is_active;
        return (array) $row;
    }

    /**
     * Seed default docs for a tenant from the built-in SUPPORT_AREAS map.
     * Idempotent — won't overwrite an admin's custom edits.
     */
    public function seedDefaultsForTenant(int $tenantId, ?int $userId = null): int
    {
        $defaults = self::defaultSeed();
        $inserted = 0;
        foreach ($defaults as $slug => $data) {
            if (in_array($slug, self::RETIRED_SLUGS, true)) {
                continue;
            }
            $exists = DB::table('ai_module_docs')
                ->where('tenant_id', $tenantId)
                ->where('module_slug', $slug)
                ->exists();
            if ($exists) {
                continue;
            }
            DB::table('ai_module_docs')->insert([
                'tenant_id' => $tenantId,
                'module_slug' => $slug,
                'title' => $data['title'],
                'body' => $data['body'],
                'keywords' => json_encode($data['keywords']),
                'is_active' => 1,
                'created_by' => $userId,
            ]);
            $inserted++;
        }
        return $inserted;
    }

    /** @return array<int, string> */
    private function decodeKeywords($value): array
    {
        if (is_array($value)) {
            return array_values(array_filter(array_map('strval', $value)));
        }
        if (!is_string($value) || trim($value) === '') {
            return [];
        }
        $decoded = json_decode($value, true);
        return is_array($decoded) ? array_values(array_filter(array_map('strval', $decoded))) : [];
    }

    /**
     * Built-in defaults — comprehensive out-of-the-box AI training for every
     * tenant. Covers platform fundamentals, every module/feature, account &
     * privacy topics, accessibility, mobile, and troubleshooting.
     *
     * Each entry is keyword-targeted: when a user's chat message contains any
     * keyword, the matching body is injected into the AI system prompt as
     * canonical grounding (see findRelevant + renderForPrompt above).
     *
     * Every body must fit MAX_BODY_INJECT_CHARS, or the assistant sees it cut
     * off mid-sentence (pinned by DefaultAiGuidesAreAccurateTest).
     *
     * Loaded once per tenant via seedDefaultsForTenant(); idempotent — won't
     * overwrite admin-edited docs sharing the same slug.
     *
     * @return array<string, array{title:string, body:string, keywords:array<int,string>}>
     */
    public static function defaultSeed(): array
    {
        return [
            // ============================================================
            // PLATFORM FUNDAMENTALS — broad catch-alls for intro questions
            // ============================================================
            'overview' => [
                'title' => 'Platform overview — what this is',
                'body' => "This is a community timebanking platform. Members exchange help and services using time credits instead of money. One hour of help = one time credit, whatever the skill. A retired teacher tutoring for an hour earns the same as someone helping a neighbour with shopping for an hour — everyone's time is equal.\n\nThe main parts:\n• Offers and requests — members post what they can help with and what they need\n• Wallet — your time credit balance and history\n• Messages — private conversations with other members\n• Feed — what's happening in your community\n• Extras your community may switch on — for example Events, Groups, Volunteering, Jobs, Marketplace, Blog, Polls, and links with partner communities\n\nEach community has its own members, offers and requests, and rules. You can use it in a web browser on a computer or phone, and there is also a phone app for Android and iPhone.",
                'keywords' => ['platform', 'what is', 'what is this', 'overview', 'about', 'how does this work', 'how does it work', 'how does the platform work', 'getting started', 'beginner', 'new here', 'tour', 'explain', 'introduction', 'intro', 'help me understand', 'community', 'site', 'website', 'app'],
            ],
            'timebanking' => [
                'title' => 'Timebanking basics & philosophy',
                'body' => "Timebanking is a way of exchanging help where the unit is one hour of a person's time, not money. The idea was developed in the 1980s by Edgar Cahn, around five core values: everyone is an asset; some work is beyond price; reciprocity; community; and respect.\n\nHow it works here:\n• One hour helping someone = one time credit earned\n• One hour of help received = one time credit spent\n• Every member's hour counts the same — no premium for 'expert' skills\n• You pay for help with credits you already have: your balance can't go below zero. A good way to start is to offer help. Your community may also give new members a few welcome credits\n• Credits don't expire, there are no fees or interest, and credits can't be bought or swapped for money\n\nWhy it works: timebanking brings out hidden skills, builds give-and-take between neighbours and gets things done that money often doesn't. It complements money rather than replacing it.\n\nTimebanks around the world adapt the model to their own community — villages, city neighbourhoods, campuses and more.",
                'keywords' => ['timebank', 'timebanking', 'time bank', 'time-bank', 'time credit', 'time credits', 'credit', 'credits', 'hour', 'hours', 'exchange', 'edgar cahn', 'philosophy', 'history', 'currency', 'how it works', 'reciprocity'],
            ],
            'getting_started' => [
                'title' => 'Getting started — your first week',
                'body' => "Welcome! Good first steps:\n\n1. Finish the welcome steps. Your Dashboard shows a short 'Getting started' list: the welcome steps, adding a photo and posting your first offer or request.\n\n2. Complete your profile. Settings → Profile. Add a photo, a short bio and where you are. A town or area is enough — what you type is shown on your profile.\n\n3. Add your skills. Settings → Skills. Tag what you're happy to help with (gardening, dog-walking, IT, lifts, a listening ear). This helps the platform suggest good matches for you.\n\n4. Browse Offers and requests. See what neighbours offer and need. No obligation to reply.\n\n5. Post your first offer. Even a small one — \"I can help with basic computer questions on Tuesday evenings\".\n\n6. Ask for help. Many new members feel awkward asking — your community wants you to. You pay with time credits you have, so offering help first (or using any welcome credits) gets you started.\n\n7. If your community has Groups or Events switched on, join a group or go to an event to meet people.\n\n8. If your community has the AI Assistant switched on (in the menu), it can help you find offers, requests and members.",
                'keywords' => ['getting started', 'first', 'first week', 'beginner', 'onboarding', 'new member', 'just joined', 'where do i start', 'how do i begin', 'next step', 'tutorial', 'walkthrough', 'tips for beginners'],
            ],
            'safety' => [
                'title' => 'Safety, trust & community guidelines',
                'body' => "• Be respectful. Discrimination, harassment, hate speech or abuse can get an account suspended.\n• Before visiting someone's home, message them first and check their profile and any reviews. Meet somewhere public the first time if you can.\n• The platform is for adults aged 18 and over. Your community may offer support choices when you join, and may require background checks (such as DBS, PVG, AccessNI or Garda vetting) for some contact.\n• Money. This is for exchanging time. If help needs materials, agree in advance who pays. Don't accept cash for time credits.\n• Exchange problems. Try to sort it out in Messages first. If your community uses Exchanges, raise a problem on the exchange and a coordinator will review it.\n• Reporting. You can report a member (from their profile), an offer or request, a feed post, or a message you received. Reports go to your community's coordinators and administrators.\n• If someone asks for money, threatens you or behaves in a predatory way, report them and block them from their profile.\n• Don't share other members' contact details, photos or stories, or anything about a vulnerable person, without consent.",
                'keywords' => ['safety', 'safe', 'trust', 'guidelines', 'rules', 'report', 'reporting', 'abuse', 'harassment', 'scam', 'suspicious', 'block', 'flag', 'safeguarding', 'vulnerable', 'children', 'vetting', 'garda', 'dbs', 'dispute', 'complaint'],
            ],

            // ============================================================
            // CORE MODULES — always-on basics
            // ============================================================
            'listings' => [
                'title' => 'Listings — offers and requests',
                'body' => "Offers and requests are the heart of the platform:\n• Offer — \"I can help with X\"\n• Request — \"I need help with X\"\nBoth are paid in time credits: one credit per hour.\n\nTo create one:\n1. Go to Offers and requests → 'Create an offer or request'\n2. Choose Offer help or Ask for help\n3. Pick a category (your community sets the list, e.g. Home & Garden, Technology, Transport, Community)\n4. Write a clear title and description. \"Weekly dog walking, 30-min walks, Monday & Thursday mornings\" beats \"Dog stuff\"\n5. Add the hours you expect it to take; a location and a photo are optional\n6. Post\n\nIf your community checks new posts first, yours appears once an administrator approves it.\n\nResponding: open one and tap 'Send message' to agree the details — date, place, materials. If your community has Exchanges switched on, you can also tap 'Request exchange'; you both confirm the hours afterwards and the credits move. Otherwise the person who received help pays with 'Send credits' in the Wallet.\n\nYours are under My offers and requests, where you can Edit, Renew or Delete them. They expire after a while — renew one to show it again.",
                'keywords' => ['listing', 'listings', 'offer', 'request', 'service', 'post a listing', 'create a listing', 'how do i post', 'how do i offer', 'how do i request', 'category', 'categories'],
            ],
            'wallet' => [
                'title' => 'Wallet & time credit balance',
                'body' => "Your wallet shows your time credit balance and transaction history. Open it from the menu under your profile picture, or go to /wallet.\n\nHow credits move:\n• Send credits: choose 'Send credits', pick the member and the hours. The credits move straight away — there is no confirmation step, so check before you send.\n• Exchanges: if your community has Exchanges switched on, arrange help with 'Request exchange' on an offer or request. When the work is done you both confirm the hours, and the credits then move automatically.\n• Donate: give credits to another member or to your community fund.\n\nYour balance can't go below zero — you can only send credits you have. Your community may give new members some welcome credits.\n\nHistory: each transaction shows the date, the other member, the hours and a description. You can download a statement.\n\nSomething wrong? If you use Exchanges, raise a problem on the exchange before it is completed and a coordinator will review it. For anything else, contact your community's coordinators.\n\nCredits don't expire and can't be exchanged for money.",
                'keywords' => ['wallet', 'balance', 'credit balance', 'hours balance', 'transfer', 'pay', 'payment', 'transaction', 'history', 'record exchange', 'log hours', 'gift hours', 'negative balance', 'how do i pay', 'dispute'],
            ],
            'messages' => [
                'title' => 'Messages — private conversations',
                'body' => "Messages are private conversations, one-to-one or in a small group.\n\nStart one: tap 'Send message' on an offer, request or profile, or in Messages choose 'New message' or 'New group'.\n\nYou can send text, photos, attachments, voice messages and emoji reactions; see when a message is read and when someone is typing; edit or delete messages; translate them (if switched on); archive a conversation; and report a message you received. To block someone, use 'Block user' on their profile. Message emails can be turned off in Settings → Notifications.\n\nWho else can see messages: to keep members safe, your community's coordinators and administrators — and the platform's own administrators — can review copies of messages. Unless your community has changed its settings, that includes a member's first messages to someone new, messages from members in their first 30 days, messages about offers or requests marked high-risk, and messages to or from a member under safeguarding monitoring. A community can also choose to review a random sample, and an administrator can switch on review of every message. A reviewer also sees up to 50 earlier messages in that conversation, and every view is recorded. While review may apply, a notice is shown in the conversation.",
                'keywords' => ['message', 'messages', 'chat', 'conversation', 'inbox', 'contact', 'send a message', 'how do i contact', 'reply', 'block someone', 'mute', 'translate'],
            ],
            'feed' => [
                'title' => 'Feed — community activity stream',
                'body' => "The Feed is your community's activity stream: posts, offers and requests, events, polls, goals, reviews and more. It's usually the first page you see after signing in.\n\nOrder: 'For you' ranks items using recency, how much you interact with the people and groups involved, and engagement (likes, comments). 'Recent' shows newest first.\n\nFilters: choose All, Following, Saved, or a type such as Posts, Offers and requests, Events or Polls.\n\nReact: like, comment and share. Mentioning a member with @ in a comment notifies them.\n\nPost: use the 'What's on your mind?' box to share text and photos, or create a poll, an offer or request, an event or a goal. Posts can be checked by moderators.\n\nSaved items: tap Save on an item, then find it under the Saved filter or on your Saved page (/saved).\n\nNot interested? Use the … menu on an item to hide that post, mute that member, or report the post.",
                'keywords' => ['feed', 'stream', 'timeline', 'home feed', 'activity', 'whats new', 'whats happening', 'post', 'create a post', 'comment', 'like', 'share', 'bookmark', 'save'],
            ],
            'dashboard' => [
                'title' => 'Dashboard — your starting point',
                'body' => "The Dashboard is your personal overview. After signing in you usually land on the Feed; open Dashboard from the menu (it becomes your start page if your community has no feed).\n\nWhat it can show:\n• Your time credit balance\n• Your offers and requests\n• Exchanges that need your attention (if your community uses Exchanges)\n• Suggested for you — offers and requests that match you\n• Recent activity from the feed\n• Upcoming events in your community (if Events is on)\n• Groups you belong to (if Groups is on)\n• Your progress — level and badges (if your community uses badges)\n• Endorsements of your skills\n• Community highlights, such as hours shared together and new members to say hello to\n\nNew members also see a 'Getting started' list: finish the welcome steps, add a photo and post a first offer or request.\n\nQuick actions: shortcuts to create an offer or request, open Messages, view your Wallet, find members, browse events and see notifications.",
                'keywords' => ['dashboard', 'home', 'home page', 'landing page', 'start page', 'overview page', 'main page'],
            ],
            'profile' => [
                'title' => 'Profile & member directory',
                'body' => "Your profile is how other members see you. They open it by tapping your name on an offer or request, a comment or a message.\n\nWhat's on it:\n• Photo and name — other members see your first name only; administrators and coordinators see your full name\n• Tagline and bio\n• Location — whatever you typed in Settings (a town or area is enough); positions on maps are shown approximately\n• Skills\n• Your offers and requests\n• Hours given and received, and how many groups and events you're in\n• Reviews (if your community uses reviews)\n• Badges and achievements (if your community uses them)\n• Availability, and the date you joined\n\nEdit it in Settings → Profile; skills are in Settings → Skills.\n\nPrivacy: in Settings → Privacy choose who can see your profile (anyone, community members, or only your connections) and whether search engines may show it. You can block a member from their profile.\n\nMember directory (/members, if your community has it on): search by name or place, view new or most active members, or use 'Near me'.",
                'keywords' => ['profile', 'my profile', 'edit profile', 'bio', 'photo', 'avatar', 'display name', 'directory', 'members', 'find a member', 'who is', 'see all members'],
            ],
            'notifications' => [
                'title' => 'Notifications',
                'body' => "Notifications keep you in the loop without checking the app all the time.\n\nWhere they show:\n• Bell icon — at the top of the page, with an unread count\n• Push notifications — on your phone or in your browser, if you've allowed them\n• Email — for the types you choose (new messages are on unless you turn them off)\n\nWhat can notify you: new messages, connection requests, activity on your offers and requests, exchanges that need you, credits received, reviews, events (including reminders 24 hours and 1 hour before), and badges.\n\nManage them in Settings → Notifications: switch each email type on or off, turn push notifications on or off, and choose how often you get match and activity digest emails.\n\nRound-up emails: you can get an email of new offers and requests (weekly, monthly or off) and a monthly community digest (off unless you turn it on). The offers and requests round-up has an unsubscribe link.\n\nClear them: open the bell and choose 'Mark all read'. The Notifications page also lets you delete them all.",
                'keywords' => ['notification', 'notifications', 'alert', 'alerts', 'push', 'email notification', 'bell', 'unread', 'quiet hours', 'do not disturb', 'digest', 'unsubscribe'],
            ],
            'settings' => [
                'title' => 'Settings — manage your account',
                'body' => "Settings is where you manage your account. Open it from the menu under your profile picture (top right), or go to /settings.\n\nTabs:\n• Profile — photo, name, phone, tagline, bio, location, interface language, and appearance (light/dark/system, colour, font size, density, high contrast, reduced motion)\n• Notifications — email types, push on/off, digest emails\n• Privacy — who can see your profile, search engines, partner communities (if on), blocked members, download your data, data rights requests, delete account\n• Security — password, two-step sign-in, passkeys (if allowed), signed-in devices, delete account\n• Skills — what you can help with\n• Availability — when you're usually free\n• Linked accounts — family or carers who help you\n• Connected — sign-in accounts linked to yours\n• Safeguarding & support — your support choices\n• Translation — auto-translation of posts and offers or requests, and your feed order\n\nUp to 11 interface languages, depending on your community: English, Irish, German, French, Italian, Portuguese, Spanish, Dutch, Polish, Japanese and Arabic (right-to-left).\n\nYou can't change your email address yourself — ask your community's administrators.",
                'keywords' => ['settings', 'preferences', 'account settings', 'change password', 'change email', 'delete account', 'export data', 'gdpr', 'language', 'theme', 'dark mode', 'light mode'],
            ],

            // ============================================================
            // OPTIONAL FEATURES (gated per tenant)
            // ============================================================
            'events' => [
                'title' => 'Events — community gatherings',
                'body' => "Events are community gatherings such as workshops, socials, work parties, talks, walks and classes. Find them at /events.\n\nFinding events: browse upcoming or past events, search by keyword, and filter by category, distance from you, and step-free access. You can also show only events you organise or are going to. You can add an event to your own calendar, or subscribe to a calendar feed that you can switch off at any time.\n\nTaking part: depending on how the organiser set it up, you can mark yourself as interested or going, register, wait for approval, or join a waiting list when the event is full. If a place opens up you may be offered it for a limited time. Some events ask you to fill in a short form, let you bring guests, or let you sign up for individual sessions. You can manage your place from the event page.\n\nCreating an event: add a title, date and time zone, an in-person place or an online link, accessibility details, a category, a picture, a capacity and, if you like, a repeating pattern, a programme of sessions and free tickets. If your community has switched on event review, an admin checks your event before it is published. Organisers get tools for the people list, messages to attendees, check-in, templates and attendance figures.\n\nReminders and notifications follow your notification settings. You can change them for all events, for a category, or for one event.\n\nTime credits: going to an event does not move time credits. Events never take card or cash payments, and time-credit tickets can't be used at the moment. If your community has switched on attendance rewards, people who are checked in may receive credits for events where the organiser has set an amount.\n\nCheck-in: organisers and their helpers can check people in by scanning a QR code, even without an internet connection, or by searching for a name.\n\nPrivacy: the attendee list, form answers, guest details, online meeting links and organiser tools are only shown to people allowed to see them.\n\nIf your community has switched on public events, people without an account can browse its events too. They still need to sign in to register.",
                'keywords' => ['event', 'events', 'rsvp', 'attend', 'workshop', 'gathering', 'social', 'meetup', 'calendar', 'class', 'recurring', 'cancel rsvp'],
            ],
            'groups' => [
                'title' => 'Groups — sub-communities',
                'body' => "Groups let members get together around a shared interest, neighbourhood or background inside the wider community. Find them at /groups.\n\nExamples: \"Gardeners\", \"Parents' coffee morning\", \"Walking buddies\", \"Computer help volunteers\".\n\nTypes:\n• Public — anyone can see posts and join straight away\n• Private — you ask to join and a group admin approves you\n• Secret — you can only join if you are invited\nYour community may switch private and secret groups off.\n\nWhat's inside a group: depending on what your community has switched on, a group can have a feed, discussions, a member list, events, files, announcements, questions and answers, a wiki, photos, chat rooms, tasks and challenges. In a private group, only approved members see posts.\n\nCreating a group: from /groups, create a group. Give it a name, a description, a picture, a group type if your community uses them, public/private/secret and, if you like, a location. You become the group's owner and can invite people by link or email. Your community may ask an admin to approve new groups before they go live, and may limit who can create groups.\n\nGroup owners and admins can edit the group, approve or turn down join requests, pin announcements, remove members and make other members admins. Only the owner can delete the group. A community admin can move ownership to someone else.\n\nJoining: open a group and choose to join (public) or ask to join (private). You'll get a notification when your request is approved or turned down.\n\nLeaving: you can leave from the group page. If you are the owner, or the only admin, hand over to someone else first.",
                'keywords' => ['group', 'groups', 'join group', 'create group', 'sub-community', 'club', 'interest group', 'neighbourhood group', 'private group', 'invite'],
            ],
            'volunteering' => [
                'title' => 'Volunteering — opportunities & shifts',
                'body' => "If the volunteering feature is switched on, approved organisations (such as charities, councils and community groups) post volunteer opportunities and shifts that members can sign up for. Find them at /volunteering.\n\nHow it differs from an offer or request: an offer or request is one member helping another. Volunteering is helping an organisation, for example \"Help at the food bank on Saturday morning\" or \"Beach clean-up on the 12th\".\n\nFinding opportunities: search, or filter by category, organisation, remote roles, or distance from you.\n\nSigning up: open an opportunity and apply. The organisation can accept or decline your application. Some communities accept applications automatically. Once accepted, you can sign up for shifts, join a waiting list for a full shift, or ask to swap a shift.\n\nVetting: some roles need references or checks, which the organisation arranges with you directly. Please don't upload or send police-check or vetting certificates through the platform.\n\nHours and time credits: after volunteering, you log your hours with the organisation. When the organisation approves them, time credits are added to your wallet automatically. Credits are added in whole hours, so part of an hour is not credited.\n\nFor organisations: an organisation dashboard lets its managers post opportunities and shifts, review applications and logged hours, manage volunteers and their team, and keep an organisation wallet of time credits.",
                'keywords' => ['volunteer', 'volunteering', 'volunteer opportunity', 'shift', 'shifts', 'opportunity', 'opportunities', 'charity', 'help out', 'give back', 'sign up to volunteer'],
            ],
            'jobs' => [
                'title' => 'Job vacancies',
                'body' => "The job board (/jobs) lists vacancies posted by members and organisations in the community. A vacancy can be a paid job, a volunteer role, or a timebanking opportunity paid in time credits.\n\nFor job seekers:\n• Search vacancies and filter by type, hours (full-time, part-time, one-off or flexible), category, remote work and distance; sort by newest, closing date or salary\n• Save vacancies for later and set up job alerts\n• Apply from the vacancy page with a covering message and, if your community allows it, a CV (PDF or Word, up to 5 MB)\n• Track your applications at /jobs/my-applications\n• Get notified when the employer updates your application\n\nFor people posting vacancies:\n• Post a vacancy with the role, description, requirements, salary and closing date\n• Manage applications: review CVs, shortlist, accept or reject, and, where your community uses them, arrange interviews and make offers\n\nCommunity admins can feature a vacancy so it stands out, and can remove vacancies. If your community has switched on job checks, new vacancies are reviewed before they appear.\n\nJobs are separate from offers and requests, which are for exchanging help for time credits.",
                'keywords' => ['job', 'jobs', 'vacancy', 'vacancies', 'employment', 'work', 'hire', 'hiring', 'apply for a job', 'cv', 'resume', 'career', 'internship'],
            ],
            'marketplace' => [
                'title' => 'Marketplace — items, not services',
                'body' => "If your community has switched on the Marketplace (/marketplace), members can sell, swap, lend or give away items. It is separate from offers and requests, which are for help exchanged for time credits.\n\nWhat fits: second-hand furniture, outgrown clothes, tools to lend, garden produce, books, electronics, art, handmade goods.\n\nPricing: an item can be:\n• Free — a give-away\n• Priced in time credits\n• Priced in money — paid online by card, if your community has card payments switched on and the seller has set up payouts\n• Open to offers — you make an offer and the seller can accept it\n• Available to borrow\n\nCreating a listing: on /marketplace choose Create Listing. Add a title, category, description, condition, photos, price and how the buyer gets it (collection, delivery or postage, depending on what your community allows). Your community may check new listings before they appear.\n\nBuying: open an item, choose how to get it and how to pay, then check out.\n\nPayment protection: if your community uses held payments, the seller's money is held until the order is completed. If something goes wrong, use the order's dispute option or report the listing.\n\nSafety: meet in a public place for valuable items where you can, keep arrangements in Messages, and rate the order afterwards.\n\nNot for the marketplace: help or services (use offers and requests), jobs (use the job board), or anything illegal.",
                'keywords' => ['marketplace', 'sell', 'buy', 'item', 'items', 'goods', 'second hand', 'free', 'freecycle', 'give away', 'swap', 'for sale'],
            ],
            'blog' => [
                'title' => 'Blog — community stories & news',
                'body' => "The Blog (/blog) is where your community's admins publish news, stories, guides, announcements and event round-ups.\n\nFor readers: browse posts by category or search for them. Each post can be liked, commented on and shared, and where available translated into your language. The blog can also be read by people who aren't signed in, and posts can appear in the community feed.\n\nWriting: blog posts are written and published by community admins; members can't submit posts. If you have a story to share, contact your community's admins.\n\nFor admins: write posts with a formatting editor, save drafts, publish or unpublish, add a cover picture and category, set the title and description shown in search engines, and publish or delete several posts at once.",
                'keywords' => ['blog', 'article', 'post', 'news', 'story', 'write a post', 'publish', 'contributor', 'editor'],
            ],
            'resources' => [
                'title' => 'Resources — knowledge base & files',
                'body' => "The Resources area (/resources) is a shared library of files for the community — guides, handbooks, policies, templates, training materials and similar.\n\nHow it works: any signed-in member can add a resource by uploading a file with a title, a description and a category. Files can be PDF, Word, Excel, text, CSV or an image (JPG, PNG, GIF or WebP), up to 10 MB. Search or filter by category to find something, then download it. You can edit or remove resources you added.\n\nKnowledge base (/kb): a searchable set of help articles written by community admins, for example \"How do I post an offer?\" or \"What's a time credit?\". You can say whether an article was helpful. The AI assistant can search these articles when answering questions.\n\nFor admins: manage resource categories, remove resources, and write and edit knowledge-base articles.",
                'keywords' => ['resource', 'resources', 'knowledge base', 'kb', 'guide', 'how to', 'faq', 'help article', 'document', 'download', 'file', 'pdf', 'handbook', 'template'],
            ],
            'polls' => [
                'title' => 'Polls — community decisions',
                'body' => "Polls (/polls) let the community decide things together — pick a date for a social, gather opinions or choose between ideas.\n\nCreating a poll: on the Polls page choose Create Poll. Write the question, add between 2 and 20 options, and choose:\n• Standard — each person picks one option\n• Ranked — each person puts the options in order of preference\nYou can also make votes anonymous and set an end date.\n\nVoting: each member votes once. To keep voting fair, the votes for each option stay hidden until the poll ends — only the poll's creator sees running totals. Everyone can see how many people have voted so far.\n\nResults: when the poll ends, everyone sees the votes and percentage for each option (ranked polls show the ranked result). Polls close automatically on their end date.\n\nIf a poll isn't anonymous, its creator is told when someone votes. The creator can delete their poll.\n\nExamples: \"Which Saturday for the autumn workshop?\", \"Which charity should we support?\", \"Vote for the photo competition winner\".",
                'keywords' => ['poll', 'polls', 'vote', 'voting', 'survey', 'decide', 'decision', 'create a poll'],
            ],
            'ideation' => [
                'title' => 'Ideation challenges — collaborative problem-solving',
                'body' => "Ideation challenges (/ideation) are a way to solve a community problem together. A community admin sets a challenge, for example \"How do we get more young people involved?\" or \"What could we do with the empty community hall?\". Members send in ideas, comment on them and vote for the ones they like.\n\nHow a challenge runs:\n1. Open — the admin posts the challenge with a description and, if they like, a category, closing dates for ideas and voting, a prize and how ideas will be judged. Members submit ideas (a title and a description) and can save an idea as a draft first. A challenge may limit how many ideas each person can send.\n2. Comments and votes — members comment on ideas and vote for the ones they support while the challenge is open or in its voting stage.\n3. Judging — the admin moves the challenge on, shortlists ideas and picks winners. Authors are notified when their idea is shortlisted or wins.\n4. Closed — the challenge ends.\n\nAn idea can also be turned into a new group so people can carry it forward.\n\nHow it differs from Polls: a poll asks people to choose between fixed options; a challenge asks for new ideas.",
                'keywords' => ['ideation', 'idea', 'ideas', 'challenge', 'challenges', 'brainstorm', 'innovation', 'submit an idea', 'creative'],
            ],
            'organisations' => [
                'title' => 'Organisations — partner profiles',
                'body' => "If your community has volunteering and organisations switched on, Organisations (/organisations) are pages for local bodies — charities, social enterprises, council services, schools, faith groups, community centres and clubs.\n\nEach organisation page shows:\n• An about section, contact email, website and logo (clubs can also show when they meet)\n• The volunteer opportunities it is offering\n• Reviews from volunteers, if your community allows them\n\nRegistering an organisation: any member can register one at /organisations/register. A community admin approves it before it goes live.\n\nTime credits: each organisation has its own time-credit wallet. When the organisation approves a volunteer's logged hours, the volunteer receives time credits. The organisation's managers can add credits to the wallet from their own balance.\n\nFor organisation managers: an organisation dashboard lets you manage your team and volunteers, post opportunities and shifts, review applications and logged hours, look after the wallet and its history, and edit your organisation's details.\n\nFor members: browse organisations, apply for their opportunities and leave a review.",
                'keywords' => ['organisation', 'organisations', 'organization', 'organizations', 'org', 'charity', 'partner', 'partner organisation', 'ngo', 'social enterprise', 'council', 'school', 'church'],
            ],
            'group_exchanges' => [
                // Rewritten 2026-09-26: the previous body described a 'beneficiary',
                // payment 'from a community pool' and per-contributor actual hours,
                // none of which exist. Communities seeded before then are corrected
                // by migration 2026_09_26_150000_correct_group_exchange_ai_module_doc.
                'title' => 'Group exchanges — one exchange, many people',
                'body' => "Group exchanges (/group-exchanges) record one time-credit exchange with several people in it, instead of many separate transfers — for example a class, a work party, or a team helping someone move house.\n\nThe rule: one hour is one time credit. People giving time earn credits; people receiving time pay them. You need at least one of each.\n\nSetting one up: give it a title and an optional description, add the people taking part, mark each as giving or receiving time, and pick the kind that fits:\n• Workshop or class — the person running it earns the hours they put in; each attendee pays the hours they attended; any hours left over go to the community's time fund.\n• A team helping someone — each helper earns the hours they spent, and the person helped pays for all of it.\n• Share equally — set one total; the people giving share it equally, and so do the people receiving.\n• Share by amount of effort — like sharing equally, but someone marked 2 gets twice the share of someone marked 1.\n• Type each person's hours — you enter what each person earns or pays; the totals must match.\nBefore you start, you see what everyone will earn or pay.\n\nConfirming: when the organiser starts the exchange, everyone is asked to confirm. If anyone is added or removed, or the details change, everyone confirms again. Once all have confirmed, the organiser completes it and every balance updates at once. If anyone paying doesn't have enough credits, nothing moves. It can be cancelled before it is completed.",
                'keywords' => ['group exchange', 'group exchanges', 'project', 'team project', 'collaborative', 'collaboration', 'work party', 'community project', 'workshop', 'community pot', 'split hours'],
            ],
            'federation' => [
                'title' => 'Federation — connecting communities',
                'body' => "Federation lets your community link up with other timebank communities on this same service, so members can find people, offers and requests, events and groups beyond their own community.\n\nWhat can be shared (each part is switched on or off separately by the platform's administrators):\n• Your community appearing in the directory of communities\n• Member profiles\n• Messages between communities\n• Time-credit exchanges between communities\n• Offers and requests\n• Events\n• Groups — a group can choose to be visible to, or open to joining from, partner communities\n\nFor members it is your choice. Go to the Federation area (/federation) to opt in, then choose what partner communities can see — your profile, skills, location and reviews — and whether you accept messages and time-credit exchanges from them. Exchanges only work between communities with an active partnership, and between members who have both opted in. You can block an individual member of a partner community; this stops messages, connection requests and credit transfers between you.\n\nLinks to timebanks on other systems stay switched off unless the platform's administrators turn them on.",
                'keywords' => ['federation', 'federated', 'federate', 'network', 'other communities', 'cross-community', 'inter-community', 'directory'],
            ],
            'gamification' => [
                'title' => 'Gamification — badges, XP, and recognition',
                'body' => "If your community has achievements switched on, the platform recognises what members do with badges, XP points, levels and a leaderboard. It is meant as gentle encouragement, not competition.\n\nBadges: earned for things like your first offer or request, your first exchange, helping several different people, helping new members with their first exchange, hosting events, and being a member for six months or a year. Your badges, progress, daily reward, challenges and the XP shop are on the Achievements page (/achievements).\n\nXP and levels: you earn XP for things like posting an offer or request, completing an exchange, attending an event and leaving a review. XP adds up to levels, from Newcomer to Legend.\n\nLeaderboard (/leaderboard): ranks members by XP, volunteer hours, credits earned or NexusScore, for all time, this season, this month or this week.\n\nVerification badges: a profile can show checks such as email, phone or ID verified. Private safeguarding checks are never shown as badges and never appear in profiles, search or the leaderboard.\n\nFor admins: an admin can switch achievements off for the whole community, change how much is needed for each badge, and create the community's own badges.",
                'keywords' => ['gamification', 'badge', 'badges', 'achievement', 'achievements', 'xp', 'level', 'levels', 'leaderboard', 'top contributor', 'reward'],
            ],
            'goals' => [
                'title' => 'Goals — personal & community targets',
                'body' => "If your community has goals switched on, Goals (/goals) lets you set a personal target and keep track of it. Examples: \"Help 12 different members this year\", \"Give 50 hours\", \"Attend 10 events\".\n\nSetting a goal: on /goals choose 'New goal'. Give it a title, an optional description, a target number and, if you like, a deadline. You can also start from a ready-made template. Goals are public (other members can see them) unless you make them private.\n\nProgress: you record your own progress; it does not update by itself. You can add check-ins and set a reminder. When you pass 25%, 50%, 75% and 100% you get an encouraging email.\n\nGoal buddies: other members can offer to be a buddy on a public goal, and you choose whether to accept.\n\nCommunity goal: your community's admin can set one shared goal, such as a number of hours shared, exchanges, offers or events by a date. Progress shows on the dashboard.",
                'keywords' => ['goal', 'goals', 'target', 'targets', 'personal goal', 'community goal', 'milestone', 'progress', 'set a goal'],
            ],
            'connections' => [
                'title' => 'Connections — your network',
                'body' => "If your community has connections switched on, Connections (/connections) are the members you have chosen to connect with, a bit like a friends list within your community.\n\nHow to connect: press 'Connect' on a member's profile. They get a request and can accept or decline. You are connected once they accept.\n\nWhat connecting does:\n• Posts from your connections are more likely to appear near the top of your feed, and the feed's 'Following' filter shows only their posts\n• If a member sets their profile to 'connections only', you can see it once you are connected\n• You can message a connection straight from your connections list\n\nManaging connections: /connections has tabs for your connections, requests you have received and requests you have sent. You can accept, decline, cancel a request you sent, or disconnect. To stop seeing someone's posts without disconnecting, use 'mute' on their post in the feed.\n\nPrivacy: in Settings → Privacy you choose who can see your profile (everyone, members only, or your connections only) and whether you appear in search.\n\nNotifications: you are told about new requests. If you decline a request, the other member is told it was not accepted.",
                'keywords' => ['connection', 'connections', 'follow', 'friend', 'friends', 'network', 'add as friend', 'unfollow', 'disconnect'],
            ],
            'reviews' => [
                'title' => 'Reviews & ratings',
                'body' => "If reviews are switched on in your community, members can rate and review each other, which builds trust and helps newcomers.\n\nWhen: as soon as an exchange is completed, both people get an email inviting them to leave a review, unless they have turned off review emails. You can also leave a review from the Reviews page (/reviews).\n\nA review is a star rating from 1 to 5 plus an optional comment.\n\nWhat reviews show: a member's profile shows their average rating, how many reviews they have, and the reviews themselves. Other members see the reviewer's first name.\n\nRules:\n• You can't review yourself\n• You can leave one review for each exchange you took part in\n• Without a linked exchange, you can review the same member at most once in 24 hours\n• Members who have blocked each other can't review each other\n• Reviews can't be edited, but you can delete a review you wrote\n• If a review is abusive, tell your community's team. Admins can hide or remove reviews",
                'keywords' => ['review', 'reviews', 'rating', 'ratings', 'star rating', 'feedback', 'leave a review', 'rate'],
            ],
            'ai_chat' => [
                'title' => 'AI assistant — the chat button',
                'body' => "If your community has switched on the AI assistant, open it from 'AI Assistant' in the menu. It answers questions about how the site works, using guides your community provides, the community's help articles, and which features your community has switched on. It can make mistakes, so check anything important.\n\nWhat it can help with:\n• Explaining a feature (\"how do I post an offer?\", \"what's a time credit?\")\n• Finding members with a skill (\"who can help me with computers?\")\n• Finding offers and requests, events and help articles, and jobs or marketplace items if your community uses them\n• Telling you your own time credit balance\n• Helping you word an offer or request, an event or a message\n\nWhat it can't do: it can't change anything on your account, act for you, or read anyone's messages. It only sees a little about you: your first name, role, language, skills, location, balance and recent offers and requests.\n\nPrivacy: your conversations are saved to your account and sent to the AI service your community has chosen. Community admins see usage totals and costs. If you press thumbs-down on an answer, admins can see that question, the answer and any comment you add, without your name. Deleting your account deletes your AI chats.\n\nFor admins: you can edit these guides for the assistant at /admin/ai/module-docs.",
                'keywords' => ['ai', 'ai chat', 'ai assistant', 'chatbot', 'assistant', 'ask the ai', 'help bot', 'sparkles', 'chat button'],
            ],
            'search' => [
                'title' => 'Search — finding anything',
                'body' => "If search is switched on in your community, press Ctrl+K (Windows) or Cmd+K (Mac), or select the search icon, to open quick search. For full results, go to /search.\n\nWhat you can search: offers and requests, members, events, groups, and podcasts if your community has them. Quick search suggests offers and requests, members, events and groups as you type.\n\nFilters: on the search page you can narrow results by type, category, skills, dates and location (a place name), and sort by relevance, newest or oldest.\n\nSpelling and similar words: search usually allows for small typing mistakes and knows some common alternatives. For example, 'fix' also finds 'repair', 'tutor' also finds 'teacher', and 'transport' also finds 'lift'.\n\nSaved searches: you can save a search and run it again later from the search page.\n\nRecent searches: quick search shows your recent searches on this device.\n\nNo results? Check the spelling, use fewer words, or remove some filters.",
                'keywords' => ['search', 'find', 'looking for', 'where is', 'how do i find', 'cmd k', 'ctrl k', 'discover'],
            ],
            'caring_community' => [
                'title' => 'Caring Community — support for vulnerable members',
                'body' => "If Caring Community is enabled in your community, there are some extra tools for communities supporting older adults, carers, people with disabilities and people at risk of isolation.

What exists:
• Ask for help or offer a favour — simple pages for small requests
• Linked supporters — a member can link a family member or carer and choose what that supporter may see or do for them. Nothing is shared without the member's choice
• Volunteer wellbeing check-ins — if volunteering is on, volunteers can record how they are doing. If they say they are low or struggling and ask for someone to get in touch, the people the community chose are told
• Step-free event filter — find events whose organiser confirmed step-free access
• Report a concern — members can report a safeguarding concern to the community's team

What does not exist: automatic check-in messages, alerts for missed check-ins, buddy pairing, a simplified 'easy mode' layout or an emergency contact button. Never promise these.

Vulnerable adult declarations and safeguarding vetting confirmations are private to the member and authorised safeguarding decision-makers; Project NEXUS does not retain criminal-record certificates.",
                'keywords' => ['caring community', 'caring', 'vulnerable', 'older', 'elderly', 'isolation', 'lonely', 'carer', 'check in', 'wellbeing', 'disability', 'accessible'],
            ],
            'newsletter' => [
                'title' => 'Newsletter & email digests',
                'body' => "If your community uses the newsletter, its admins write it and send it by email, for example news, upcoming events and announcements. How often it goes out is up to them.\n\nSubscribing: newsletters sent to all members reach every active member who has not unsubscribed. To stop them, use the unsubscribe link at the bottom of any newsletter.\n\nFor admins: the newsletter tools are at /admin/newsletters. You can write and design newsletters, use templates, choose who receives them, preview, send a test, schedule a send, and see open and click figures.\n\nLanguage: the standard parts of the email, such as the footer and unsubscribe link, appear in each member's chosen language. The newsletter's own text appears as the admins wrote it.",
                'keywords' => ['newsletter', 'email digest', 'weekly email', 'unsubscribe', 'subscribe', 'email updates'],
            ],

            // ============================================================
            // ACCOUNT, SECURITY, PRIVACY
            // ============================================================
            'account_security' => [
                'title' => 'Account security — passwords, 2FA, passkeys',
                'body' => "Your security options are in Settings → Security.\n\nPassword: at least 12 characters, and you can't reuse a recent password. Change it in Settings → Security → Change password. Changing your password signs you out on every device. Forgotten it? Use 'Forgot password?' on the sign-in page and a reset link is emailed to you.\n\nTwo-step sign-in: adds a second check when you sign in, using an authenticator app (for example Google Authenticator or Authy). Scan the QR code, then enter the 6-digit code. Save your backup codes somewhere safe; you can use one if you lose your phone. Admins and staff must use two-step sign-in, and a community can require it for members.\n\nPasskeys (if your community has them switched on): sign in with your fingerprint, face, device PIN or a security key instead of a password. Add one in Settings → Security and follow your device's prompts.\n\nSigned-in devices: Settings → Security lists the devices signed in to your account, with the browser, device and last active date.\n\nIf you think someone else has got into your account: change your password straight away (this signs out every device), turn on two-step sign-in, and tell your community's team.",
                'keywords' => ['password', 'change password', 'forgot password', 'reset password', '2fa', 'two factor', 'two-factor', 'authenticator', 'passkey', 'passkeys', 'windows hello', 'touch id', 'face id', 'security key', 'login', 'sign in', 'signin'],
            ],
            'privacy_data' => [
                'title' => 'Privacy & data rights (GDPR)',
                'body' => "You have rights over your data: to see it, take a copy, have it corrected, and have it deleted.\n\nWhat the platform holds: your profile, offers and requests, posts, messages, exchange history, notification settings and sign-in records (such as device and IP address). Passwords are never stored as plain text.\n\nDownload your data: Settings → Privacy → Export my data. Choose a single file (JSON) or a ZIP and it downloads straight away.\n\nOther requests: in Settings → Privacy you can also ask your community's team to correct your data, limit how it is used, or object to how it is used.\n\nDelete your account: Settings → Privacy → Delete account, then confirm with your password. This is immediate and can't be undone. Your name becomes 'Deleted User'. Your offers and requests, uploaded files, passkeys and AI chats are removed, and the text of messages you sent is wiped; the other person still sees that a conversation took place. You get a confirmation email and your community's admins are told.\n\nCookies: see the Cookies page in the footer. Essential cookies are always on; analytics cookies stay off unless you agree.\n\nQuestions or complaints: contact your community's team (Contact us link in the footer) or read your community's Privacy page. You may also have the right to complain to your country's data protection authority.",
                'keywords' => ['privacy', 'gdpr', 'data', 'my data', 'export data', 'delete account', 'data protection', 'data rights', 'cookie', 'cookies', 'tracking'],
            ],
            'accessibility' => [
                'title' => 'Accessibility — themes, languages, assistive tech',
                'body' => "The site aims to meet the WCAG 2.1 AA accessibility standard and to work with keyboards and screen readers.\n\nAppearance: Settings → Profile → Appearance. Choose light, dark or follow your device, or use the sun/moon button at the top. You can also pick an accent colour, text size (small, medium or large) and spacing (compact, comfortable or spacious).\n\nAccessibility switches (same place): Large Text; High Contrast (stronger borders, text contrast and focus outlines); Reduced Motion (fewer animations and scrolling effects); and Simplified Layout (less blur, shadow and decoration).\n\nLanguages: 11 are available: English, Irish (Gaeilge), German (Deutsch), French (Français), Italian (Italiano), Portuguese (Português), Spanish (Español), Dutch (Nederlands), Polish (Polski), Japanese (日本語) and Arabic (العربية), shown right to left. Choose yours in Settings → Profile. Emails are sent in your chosen language.\n\nKeyboard: a 'Skip to main content' link appears at the top of each page, and Ctrl+K (Cmd+K on Mac) opens search.\n\nImage descriptions: organisers can add a description to event and group pictures for screen-reader users.\n\nAccessible site: there is also a simple, HTML-first version of your community's site, built for maximum accessibility. Add /accessible after your community's address on the platform, or use your community's own accessible address if it has one.",
                'keywords' => ['accessibility', 'a11y', 'screen reader', 'wcag', 'language', 'languages', 'theme', 'dark mode', 'light mode', 'font size', 'text size', 'reduce motion', 'high contrast', 'irish', 'gaeilge', 'rtl', 'arabic', 'translation'],
            ],
            'mobile_pwa' => [
                'title' => 'Mobile app & PWA',
                'body' => "You can use your community on a phone in two ways.\n\n1. The phone app: a free app for iPhone, iPad and Android. Download it from the App Store or Google Play, choose your community from the list and sign in with your usual account. It is an early release, so a few things are still to come. The 'Get the app' page (/install-app) has the store links and QR codes. It needs iOS 15.1 or later, or Android 7.0 or later.\n\n2. The website on your home screen: open the site in your phone's browser and choose 'Add to Home Screen' (iPhone, Safari) or 'Install app' (Android, Chrome). It then opens like an app. The 'Get the app' page shows the steps for each kind of device. The website is the most stable option today.\n\nYou need an internet connection to use your account; signed-in pages don't work offline.\n\nUpdates: the website updates itself. You get the newest version the next time you open it or move to another page.\n\nNotifications: on the website, turn them on in Settings → Notifications. The phone app can notify you even when it is closed.\n\nIf the site seems stuck on an old version, close it fully and open it again, or refresh the page.",
                'keywords' => ['mobile', 'phone', 'app', 'pwa', 'install', 'home screen', 'ios', 'android', 'iphone', 'ipad', 'samsung', 'tablet', 'native app', 'push notification', 'offline'],
            ],
            'troubleshooting' => [
                'title' => 'Troubleshooting common issues',
                'body' => "If something isn't working, try these in order:\n\n1. Refresh the page (Ctrl+R, or Cmd+R on a Mac).\n2. Sign out and back in: Settings → Security → Log out.\n3. Close the browser or app completely and open it again.\n4. Try a different browser or device.\n5. Check your internet connection. A banner appears if you go offline.\n6. If notifications have stopped, check they are still on in Settings → Notifications and in your phone's settings.\n\nCan't sign in?\n• Forgotten password: use 'Forgot password?' on the sign-in page\n• Email not recognised: check you are using the address you signed up with\n• Account suspended: contact your community's team\n• Two-step code not working: make sure your phone's clock is set automatically, or use one of your backup codes\n\nCan't find something you used to see?\n• Your community may have switched that feature off\n• Your role may have changed\n• It may have moved; try search (Ctrl+K or Cmd+K)\n\nStill stuck? Use the Help Centre (Help link in the footer), the Contact us link in the footer (it goes to your community's team), or the AI Assistant if your community has it switched on.",
                'keywords' => ['troubleshoot', 'not working', 'broken', 'cant login', 'cant sign in', 'error', 'bug', 'stuck', 'frozen', 'slow', 'refresh', 'clear cache', 'help me fix'],
            ],
            'admin_overview' => [
                'title' => 'For community admins',
                'body' => "If you're a community admin, the Admin panel (/admin) is where you run your community.\n\nKey areas:\n• Members (/admin/users): add, approve, edit, suspend and reactivate members\n• Listings (/admin/listings): approve, feature or remove offers and requests\n• Events and groups: approve, reject, postpone or cancel events; approve groups and moderate group content\n• Module configuration (/admin/module-configuration): switch features on or off for your community\n• Make it yours (/admin/make-it-yours): your community colour, welcome line, a shared community goal and more\n• Legal documents (/admin/legal-documents): your own Terms, Privacy and Cookies pages\n• Newsletters (/admin/newsletters): write, schedule and send newsletters\n• Achievements (/admin/gamification): badges, challenges and campaigns\n• AI assistant guides (/admin/ai/module-docs) and AI usage (/admin/ai/metrics), if your community uses the AI assistant\n• Activity log (/admin/activity-log): which admin did what, when, and from which IP address\n• Billing (/admin/billing), where it applies\n\nModeration, safeguarding, message review and vetting are in the Broker panel (/broker), which admins and brokers can open.\n\nLinks with partner communities are in the Partner timebanks panel (/partner-timebanks). Admins who look after more than one community have a separate Super admin panel.",
                'keywords' => ['admin', 'administrator', 'admin panel', 'super admin', 'manage community', 'moderation', 'moderate', 'approve', 'suspend', 'role', 'permissions', 'analytics', 'reports'],
            ],
        ];
    }
}
