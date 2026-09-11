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
    private const MAX_BODY_INJECT_CHARS = 1200;

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
            $lines[] = $doc['body'];
        }
        return implode("\n", $lines);
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
     * Bodies are deliberately kept ≤ ~1200 chars so the injection limit
     * (MAX_BODY_INJECT_CHARS) doesn't truncate mid-sentence.
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
                'body' => "This is a community timebanking platform. Members exchange help and services using time credits instead of money. One hour of help earned = one time credit, regardless of the skill involved. A retired teacher tutoring a child for an hour earns the same as a young person helping a neighbour with shopping for an hour — every member's time is treated as equal.\n\nThe platform has many modules:\n• Listings — members post offers (\"I can help with…\") and requests (\"I need help with…\")\n• Wallet — your time credit balance and transaction history\n• Messages — private conversations with other members\n• Feed — community activity stream\n• Events, Groups, Volunteering, Jobs, Marketplace, Blog, Polls — optional modules each community can enable\n• Federation — connect with other timebank communities to exchange across networks\n\nIt's multi-tenant: each community ('tenant') runs as its own space with its own members, listings, and rules, but the underlying platform is shared. Members sign in once and can engage with their community on web (desktop or mobile browser) and via the native Expo / React Native app in mobile/ (Android and iOS).",
                'keywords' => ['platform', 'what is', 'what is this', 'overview', 'about', 'how does this work', 'how does it work', 'how does the platform work', 'getting started', 'beginner', 'new here', 'tour', 'explain', 'introduction', 'intro', 'help me understand', 'community', 'site', 'website', 'app'],
            ],
            'timebanking' => [
                'title' => 'Timebanking basics & philosophy',
                'body' => "Timebanking is a community currency model where the unit of exchange is one hour of a person's time — not money. Founded in the 1980s by Edgar Cahn, it rests on five core values: every person is an asset; some work is beyond price; reciprocity helps; community matters; respect underlies everything.\n\nHow it works on this platform:\n• One hour helping someone = one time credit earned\n• One hour of help received = one time credit spent\n• Every member's hour is equal — no premium for 'expert' skills\n• Negative balances are fine, especially when starting out. Receiving help first and 'paying it forward' later is encouraged\n• There's no interest, no expiration, no fees, no cash conversion\n• The platform never holds money — it tracks time, not currency\n\nWhy it works: timebanking surfaces hidden skills (retired people, carers, neighbours), builds reciprocal relationships, reduces isolation, and gets things done that the cash economy ignores. It complements money, doesn't replace it.\n\nGlobally, there are ~500+ active timebanks across 40+ countries. Each one tailors the model to its community — rural villages, urban estates, university campuses, refugee networks, hospitals.",
                'keywords' => ['timebank', 'timebanking', 'time bank', 'time-bank', 'time credit', 'time credits', 'credit', 'credits', 'hour', 'hours', 'exchange', 'edgar cahn', 'philosophy', 'history', 'currency', 'how it works', 'reciprocity'],
            ],
            'getting_started' => [
                'title' => 'Getting started — your first week',
                'body' => "Welcome! Here's how to make the most of the platform in your first week:\n\n1. Complete your profile. Go to Settings → Profile. Add a photo, short bio, your location (rough area is fine — exact address is private), and the languages you speak. A complete profile gets ~3x more responses.\n\n2. List your skills. Settings → Skills. Tag what you're willing to help with (gardening, dog-walking, IT, languages, lifts, listening). This helps the AI assistant and other members find you.\n\n3. Browse Listings. See what your neighbours are offering and requesting. Don't feel obliged to respond — just get a feel for the community.\n\n4. Post your first offer. Even a small one — \"I can help with basic computer questions on Tuesday evenings\". The first listing is the hardest. After that it's easy.\n\n5. Try requesting. Many new members feel awkward asking for help. The community wants you to — that's how the cycle starts. Start small: a lift, help moving a piece of furniture, a question answered.\n\n6. Join a group or attend an event. This is where most lasting connections form.\n\n7. Use the AI assistant (the chat button) — it knows every feature and can find members with the skill you need.",
                'keywords' => ['getting started', 'first', 'first week', 'beginner', 'onboarding', 'new member', 'just joined', 'where do i start', 'how do i begin', 'next step', 'tutorial', 'walkthrough', 'tips for beginners'],
            ],
            'safety' => [
                'title' => 'Safety, trust & community guidelines',
                'body' => "Every community on this platform shares core safety principles:\n\n• Be respectful. Discrimination, harassment, hate speech, or abusive language get accounts suspended.\n• Verify before going to someone's home. Use Messages first, check their profile, read reviews if available. Meet in a public place for first exchanges where possible.\n• Vulnerable adults & children. Communities that work with vulnerable people use the Safeguarding step in onboarding and may require Garda vetting (Ireland) / DBS checks (UK) for certain activities. Never share personal information about a vulnerable person publicly.\n• Money. The platform is for time exchange. If a service involves materials (e.g. paint, parts), the requester usually covers cost — agree in advance. Don't accept cash for time credits.\n• Disputes. If an exchange goes wrong: try to resolve directly via Messages first. If that fails, the community admin can mediate — use the Report button on a listing/profile/message.\n• Reporting abuse. The flag icon on any content opens a report form. Reports go to the community admin (and to platform super-admins for safety issues).\n• Suspicious accounts. If someone asks for money, threatens you, or behaves predatorily, report immediately and block them.\n• Privacy. Don't share other members' contact details, photos, or stories without consent.",
                'keywords' => ['safety', 'safe', 'trust', 'guidelines', 'rules', 'report', 'reporting', 'abuse', 'harassment', 'scam', 'suspicious', 'block', 'flag', 'safeguarding', 'vulnerable', 'children', 'vetting', 'garda', 'dbs', 'dispute', 'complaint'],
            ],

            // ============================================================
            // CORE MODULES — always-on basics
            // ============================================================
            'listings' => [
                'title' => 'Listings — offers and requests',
                'body' => "Listings are the heart of the platform. There are two kinds:\n• Offer — \"I can help with X\" (you have a skill or time to give)\n• Request — \"I need help with X\" (you need help from a member)\n\nBoth are paid in time credits at one credit per hour.\n\nHow to create one:\n1. Go to /listings → 'Create listing'\n2. Choose Offer or Request\n3. Pick a category (Home & Garden, Tech, Education, Health, Transport, Creative, Professional, Community, etc.)\n4. Write a clear title and description. Be specific: \"Weekly dog walking, 30-min walks, Monday & Thursday mornings\" beats \"Dog stuff\"\n5. Optional: estimated hours, location (suburb is enough), photo\n6. Publish\n\nSome communities require admin moderation — your listing won't appear publicly until approved.\n\nResponding: tap a listing, read the details, then 'Send message' to start a private chat. Agree the details — date, location, materials — then meet. After the exchange, record it in the wallet so the credit transfer happens.\n\nEdit/remove: your own listings have Edit and Delete buttons. Closed/completed listings can be archived.",
                'keywords' => ['listing', 'listings', 'offer', 'request', 'service', 'post a listing', 'create a listing', 'how do i post', 'how do i offer', 'how do i request', 'category', 'categories'],
            ],
            'wallet' => [
                'title' => 'Wallet & time credit balance',
                'body' => "Your wallet shows your current time credit balance and full transaction history. Find it at /wallet or under your profile menu.\n\nHow credits move:\n• Someone helps you → they earn credits, you spend credits (one credit per hour)\n• Either party can record the exchange. The other party gets a notification to confirm. Once both confirm, the transfer is final.\n• A pending transfer shows in 'Awaiting confirmation' until accepted/rejected\n\nNegative balances are normal — especially when you're new. It just means the community has helped you, and you're expected to pay it forward in time. There's no penalty for being negative, no interest, no fees, no time limit.\n\nTransfers between members: you can also gift credits to another member (e.g. to thank them, sponsor a new neighbour) via the 'Transfer' button if your community allows it.\n\nAll history is visible to you. Each transaction shows date, who, hours, listing reference, and a confirmation timestamp. You can dispute a recorded exchange within 7 days if you believe it's wrong — contact the community admin.\n\nCredits never expire and never convert to cash. They are reputation, not currency.",
                'keywords' => ['wallet', 'balance', 'credit balance', 'hours balance', 'transfer', 'pay', 'payment', 'transaction', 'history', 'record exchange', 'log hours', 'gift hours', 'negative balance', 'how do i pay', 'dispute'],
            ],
            'messages' => [
                'title' => 'Messages — private conversations',
                'body' => "Messages are private one-to-one or group conversations between members. They're how exchanges get arranged.\n\nWays to start a conversation:\n• From a listing — tap 'Send message' on any listing\n• From a profile — tap 'Message' on a member's profile\n• From an event/group — group chats appear automatically for members\n• From your inbox — /messages → 'New message', search a member by name or skill\n\nInside a conversation you can:\n• Send text, emoji, images, and (if enabled) attachments\n• See read receipts and typing indicators in real time\n• Use the language translator (auto-translate to your preferred language)\n• Mark messages as flag/important\n• Mute or archive a conversation\n• Block a member if needed (their messages stop appearing; they can't see your profile)\n\nGroup chats: created automatically inside Groups and Events that have chat enabled. Admins can pin announcements and remove disruptive members.\n\nNotifications: new messages trigger push notifications (mobile/PWA) and an unread count badge. Notification frequency is configurable in Settings → Notifications.\n\nPrivacy: messages are private between participants. Admins can only see messages reported for abuse.",
                'keywords' => ['message', 'messages', 'chat', 'conversation', 'inbox', 'contact', 'send a message', 'how do i contact', 'reply', 'block someone', 'mute', 'translate'],
            ],
            'feed' => [
                'title' => 'Feed — community activity stream',
                'body' => "The Feed is your community's activity stream. It shows what's happening across the platform in a ranked, personalised order — new listings, upcoming events, group posts, completed exchanges, achievements unlocked, polls running, and more.\n\nRanking: the feed uses an EdgeRank-style algorithm — recency, affinity (how often you interact with that person/group), and engagement (likes/comments) all factor in. Items you've interacted with before, from people you message often, in groups you're active in, rank higher.\n\nFilters: tap 'All', 'Following', or specific types (Listings only, Events only, Posts only) along the top.\n\nReact: like, comment, share. Comments support @mentions which notify that member.\n\nPost to the feed: tap 'Create post' to share text, photos, polls, or a quick offer/request. Posts respect your community's content guidelines and may be moderated.\n\nSaved items: bookmark a feed item to find it later under /bookmarks.\n\nMuting: tap the … menu on any item to mute that author or hide that type of post.",
                'keywords' => ['feed', 'stream', 'timeline', 'home feed', 'activity', 'whats new', 'whats happening', 'post', 'create a post', 'comment', 'like', 'share', 'bookmark', 'save'],
            ],
            'dashboard' => [
                'title' => 'Dashboard — your starting point',
                'body' => "The Dashboard is your personal landing page when you sign in. It shows everything that needs your attention or might interest you:\n\n• Your wallet balance and recent transactions\n• Pending exchange confirmations\n• Unread messages and notifications\n• Listings matching your skills (smart matches)\n• Upcoming events you've RSVP'd to\n• Groups with new activity\n• Goals progress and gamification badges earned\n• Suggested members to connect with\n• Community announcements from admins\n\nThe dashboard adapts as you use the platform — the more activity you have, the richer it gets. It's also where new members see onboarding prompts: complete your profile, add skills, post your first listing, join your first group.\n\nQuick actions: there are shortcut buttons for the most common tasks — create a listing, record an exchange, open messages, browse events. These save tapping through menus.",
                'keywords' => ['dashboard', 'home', 'home page', 'landing page', 'start page', 'overview page', 'main page'],
            ],
            'profile' => [
                'title' => 'Profile & member directory',
                'body' => "Your profile is your public face on the platform. Other members see it when they tap your name anywhere — on a listing, in a comment, in Messages.\n\nWhat's on your profile:\n• Photo & display name\n• Bio — a short personal intro\n• Location — typically suburb/town level (full address is never public)\n• Languages you speak\n• Skills you've listed (tags)\n• Listings you've posted (active offers/requests)\n• Reviews & ratings from past exchanges (if the reviews feature is on)\n• Badges & achievements (if gamification is on)\n• Groups & organisations you belong to (public ones only)\n• Member since date\n\nEdit your profile: Settings → Profile. Photo, bio, location, languages, skills are all editable any time.\n\nPrivacy controls: Settings → Privacy. You can hide your last-seen status, hide your wallet balance, hide your transaction count, hide your real name (use display name only), and restrict who can message you.\n\nMember directory (/members): browse all members in your community. Filter by skill, language, location, or whether they have active listings.",
                'keywords' => ['profile', 'my profile', 'edit profile', 'bio', 'photo', 'avatar', 'display name', 'directory', 'members', 'find a member', 'who is', 'see all members'],
            ],
            'notifications' => [
                'title' => 'Notifications',
                'body' => "Notifications keep you in the loop without forcing you to check the app constantly.\n\nWhere they show:\n• Bell icon — top of every page, with an unread count badge\n• Push notifications — on mobile (PWA / installed app) and desktop browser if you've allowed them\n• Email — for important things (new messages while you're offline, exchange confirmations, weekly digest)\n\nWhat triggers a notification: new direct message, exchange confirmation needed, response to your listing, reply to your post/comment, RSVP confirmation, event reminder (24h before), goal milestone reached, badge unlocked, group invite, community announcement.\n\nManage them: Settings → Notifications. You can toggle each channel (in-app, push, email) and each event type independently. Quiet hours are supported — no push between e.g. 10pm and 7am.\n\nWeekly digest: if email is on, you get a single weekly digest summarising community activity, new members, popular listings, and your own stats. Unsubscribe link is in every digest.\n\nClear all: tap the bell icon → 'Mark all as read'.",
                'keywords' => ['notification', 'notifications', 'alert', 'alerts', 'push', 'email notification', 'bell', 'unread', 'quiet hours', 'do not disturb', 'digest', 'unsubscribe'],
            ],
            'settings' => [
                'title' => 'Settings — manage your account',
                'body' => "Settings is where you control everything about your account. Find it via the menu under your avatar (top right) or at /settings.\n\nSections:\n• Profile — name, bio, photo, location, languages, skills, visibility\n• Account — email, password change, two-factor auth (2FA), passkeys (Windows Hello, Touch ID, security keys), connected social logins, delete account\n• Notifications — in-app, push, email; per-event-type toggles; quiet hours\n• Privacy — who can see your profile, wallet balance, last-seen; who can message you; data export (GDPR); data deletion\n• Appearance — light/dark/system theme, font size, reduce motion\n• Language — your interface language (11 supported including English, Irish, German, French, Italian, Portuguese, Spanish, Dutch, Polish, Japanese, Arabic with RTL)\n• Communication preferences — auto-translate messages, default reply mode\n• Mobile — install the app (PWA), enable push, manage devices\n• Goals — set personal targets (hours given, hours received, members helped)\n• Connected services — calendar sync, contact import (where enabled)\n• Help & support — contact admins, report issues, view legal docs",
                'keywords' => ['settings', 'preferences', 'account settings', 'change password', 'change email', 'delete account', 'export data', 'gdpr', 'language', 'theme', 'dark mode', 'light mode'],
            ],

            // ============================================================
            // OPTIONAL FEATURES (gated per tenant)
            // ============================================================
            'events' => [
                'title' => 'Events — community gatherings',
                'body' => "Events are authenticated community gatherings such as workshops, socials, work parties, talks, walks, and classes. Find them at /events when your community has enabled the Events feature.\n\nFinding events: browse authorised published events in date order; search and filter by date, category, location/distance, online or in-person format, series, and venue-accessibility needs. Calendar actions and revocable feeds are available for events you are entitled to see.\n\nTaking part: an event can offer interest, registration, approval, capacity, a timed waitlist offer, invitations, a registration form, guests, and per-session agenda registration. Your registration, waitlist, attendance, reminder, and ticket states are separate. You can manage your own current state from the event page; email is optional and is never the authority for accepting a waitlist offer.\n\nCreating and managing: authorised members can draft an event, choose its IANA timezone, location or protected online access, accessibility information, capacity, category, image, recurrence, safety requirements, agenda, free or time-credit ticket definitions, registration settings, and staff roles. Communities can require review before publication. Organisers get capability-scoped People, communications, check-in, templates, analytics, lifecycle, and audit tools.\n\nNotifications and reminders respect your global, category, and event choices independently for bell, email, web push, mobile push, and realtime delivery. Messages render in your preferred language.\n\nAttendance does not automatically transfer time credits, and Events does not process cash. Time-credit ticket settlement remains unavailable unless the community has an explicitly approved funding and reversal policy. Offline QR check-in is for authorised staff, with manual search available when a camera or network is unavailable.\n\nPrivacy: rosters, registration answers, guest contact details, meeting links, staff resources, offline credentials, and delivery evidence are permission-protected and are not exposed in ordinary event results.",
                'keywords' => ['event', 'events', 'rsvp', 'attend', 'workshop', 'gathering', 'social', 'meetup', 'calendar', 'class', 'recurring', 'cancel rsvp'],
            ],
            'groups' => [
                'title' => 'Groups — sub-communities',
                'body' => "Groups let members organise around a shared interest, neighbourhood, or identity inside the broader community. Find them at /groups.\n\nExamples: \"East Galway gardeners\", \"Polish-speaking parents\", \"Young carers\", \"IT support volunteers\", \"Walking buddies 60+\".\n\nTypes:\n• Open — anyone can join instantly\n• Private — must request to join; admin approves\n• Hidden — invite-only, not listed publicly\n\nWhat's inside a group: a feed of posts (members only), member list, group chat (real-time), shared events, shared listings (offers/requests specific to the group), shared resources/files (if enabled).\n\nCreating a group: /groups → 'Create group'. Set name, description, photo, category, type (open/private/hidden), optional location. You become the first admin and can invite founding members. Some communities require admin approval before a new group goes live.\n\nGroup admins can: edit group info, approve join requests, pin posts, remove members, transfer admin rights, archive the group.\n\nJoining: tap a group → 'Join' (open) or 'Request to join' (private). You'll be notified when approved.\n\nLeaving: any time, from the group page menu.",
                'keywords' => ['group', 'groups', 'join group', 'create group', 'sub-community', 'club', 'interest group', 'neighbourhood group', 'private group', 'invite'],
            ],
            'volunteering' => [
                'title' => 'Volunteering — opportunities & shifts',
                'body' => "If the volunteering feature is enabled, partner organisations (charities, councils, community groups) post volunteer opportunities and shifts that members can sign up for. Find them at /volunteering.\n\nHow it differs from a Listing: a Listing is a peer-to-peer service exchange. Volunteering is structured engagement with an organisation — e.g. \"Help at the food bank Saturday morning\", \"Befriend an isolated older person weekly\", \"Beach cleanup on the 12th\".\n\nFinding opportunities: browse by category (befriending, environment, education, IT, transport, admin, events), location, time commitment (one-off vs ongoing), accessibility, required skills.\n\nSigning up: tap an opportunity → 'Sign up' or 'Request to volunteer'. The organisation gets your application and can approve, message you, or decline. Some roles require references or role-specific vetting arranged lawfully by the organisation outside Project NEXUS. Do not upload a Garda, DBS, AccessNI, PVG, police-check or equivalent certificate as a volunteering credential or message attachment. A safeguarding contact confirmation is not role clearance.\n\nHours logging: when you complete a shift, the organisation marks attendance. Hours appear in your wallet automatically. Some organisations pay in time credits, some don't — each opportunity says clearly.\n\nFor organisations: there's a full org dashboard for posting opportunities, managing volunteers, recording attendance, depositing time credits, generating reports for funders.",
                'keywords' => ['volunteer', 'volunteering', 'volunteer opportunity', 'shift', 'shifts', 'opportunity', 'opportunities', 'charity', 'help out', 'give back', 'sign up to volunteer'],
            ],
            'jobs' => [
                'title' => 'Job vacancies',
                'body' => "The Job Vacancies board (/jobs) lists paid roles, internships, and skilled-volunteering posts from employers and organisations in the community.\n\nFor job seekers:\n• Browse vacancies, filter by remote/hybrid/in-person, full/part-time/contract, salary range, category, location\n• Save vacancies to a shortlist\n• Apply directly: upload a CV (PDF or doc), write a covering message, optionally answer screening questions\n• Track your applications under /jobs/applications\n• Get notified when an employer responds\n\nFor employers (organisation admins):\n• Post a vacancy with full details: role, description, requirements, salary, benefits, application deadline, where to apply\n• Manage applications: review CVs, message candidates, shortlist, reject, mark as hired\n• Promote a vacancy to the homepage (feature varies per tenant)\n\nThe jobs board is moderated by community admins — vacancies that don't meet community standards (scams, multi-level marketing, discriminatory listings) are removed.\n\nJobs is a separate module from Listings (which is for time-credit service exchanges). Jobs is always paid in money, not time credits.",
                'keywords' => ['job', 'jobs', 'vacancy', 'vacancies', 'employment', 'work', 'hire', 'hiring', 'apply for a job', 'cv', 'resume', 'career', 'internship'],
            ],
            'marketplace' => [
                'title' => 'Marketplace — items, not services',
                'body' => "The Marketplace (/marketplace) is for physical or digital items being sold, swapped, or given away — distinct from Listings (which is for services in exchange for time credits).\n\nWhat fits the marketplace: second-hand furniture, kids' clothes outgrown, tools to lend, garden produce, books, electronics, art, handmade goods, food shares, freecycle items.\n\nPricing: each item can be:\n• Free — give-away / freecycle\n• Time credits — exchange in hours\n• Cash-priced items — secure online card payment after the seller completes payment onboarding\n• Best offer — negotiate with the seller before checkout\n\nCreating a listing: /marketplace → 'New listing'. Add title, category, description, photos (up to 10), price/credits/free, pickup/delivery/shipping options, location.\n\nBuying / requesting: open an item, choose the available fulfilment and payment options, then complete checkout. Pickup bookings and accepted offers must be completed through their dedicated marketplace checkout.\n\nPayment protection: online card payments are processed by the configured payment provider. Where marketplace escrow is enabled, seller payout is delayed until the order reaches the configured release state. The marketplace does not treat an unrecorded cash handoff as a paid order. Use the marketplace order, report, and dispute tools if something goes wrong.\n\nSafety: meet in public places for high-value items where possible, keep order arrangements in platform Messages, and use Reviews after the transaction.\n\nNot for marketplace: services (use Listings), jobs (use Jobs board), event tickets (use Events), illegal items, weapons, animals, alcohol unless local rules permit.",
                'keywords' => ['marketplace', 'sell', 'buy', 'item', 'items', 'goods', 'second hand', 'free', 'freecycle', 'give away', 'swap', 'for sale'],
            ],
            'blog' => [
                'title' => 'Blog — community stories & news',
                'body' => "The Blog (/blog) is where the community publishes longer-form content: news, member stories, how-to guides, community announcements, event recaps, opinion pieces.\n\nFor readers: browse posts by category or tag, search, filter by author. Each post has comments, likes, and share buttons. Subscribe to the blog to get email/push when new posts are published.\n\nFor writers: members with the contributor role (or all members, depending on tenant settings) can submit blog posts. Posts go through admin moderation by default before publishing. Rich text editor supports headings, lists, images, embedded videos, quotes.\n\nFor admins: full editorial control — schedule posts, edit/approve/reject submissions, manage authors, set featured posts for the homepage, categorise & tag, set SEO meta tags.\n\nBlog posts also feed into the public-facing site (for SEO) and the community feed.",
                'keywords' => ['blog', 'article', 'post', 'news', 'story', 'write a post', 'publish', 'contributor', 'editor'],
            ],
            'resources' => [
                'title' => 'Resources — knowledge base & files',
                'body' => "The Resources area (/resources) is a curated library of useful files, guides, links, and knowledge-base articles for the community.\n\nWhat goes there: how-to guides, member handbooks, policy documents, safeguarding info, templates (e.g. consent forms), training materials, helpful external links, FAQs, video tutorials.\n\nStructure: resources are grouped into categories and tagged. Each resource has a title, description, optional file upload (PDF, doc, image, video), optional external link, author, and last-updated date.\n\nKnowledge base (/kb): a sub-section dedicated to searchable Q&A articles — \"How do I post a listing?\", \"What's a time credit?\", \"How do I cancel an event?\". The AI assistant draws on KB articles to answer member questions.\n\nFor admins: upload new resources, organise into categories, control visibility (public vs members-only vs group-only), version history, set featured resources for the dashboard.",
                'keywords' => ['resource', 'resources', 'knowledge base', 'kb', 'guide', 'how to', 'faq', 'help article', 'document', 'download', 'file', 'pdf', 'handbook', 'template'],
            ],
            'polls' => [
                'title' => 'Polls — community decisions',
                'body' => "Polls (/polls) let the community make decisions together — pick a date for a social, vote on a new feature, gather opinions, prioritise projects.\n\nCreating a poll: /polls → 'New poll'. Set the question, 2–10 options, single-choice or multiple-choice, optional anonymous voting, end date.\n\nVoting: anyone with permission (members of the community, or members of a specific group if scoped) votes once. Results show live (or after the poll closes, if set to hidden-until-end).\n\nResults: bar chart of votes per option, total votes, percentage, list of voters (unless anonymous). Tap any voter to see their profile.\n\nClosing & follow-up: polls close automatically on the end date. The creator can extend, close early, or post a follow-up summary explaining what was decided and what happens next.\n\nUse cases: \"Which Saturday for the autumn workshop?\", \"Which charity should we partner with?\", \"Are you happy with the new opening hours?\", \"Vote for the community photo competition winner\".",
                'keywords' => ['poll', 'polls', 'vote', 'voting', 'survey', 'decide', 'decision', 'create a poll'],
            ],
            'ideation' => [
                'title' => 'Ideation challenges — collaborative problem-solving',
                'body' => "Ideation Challenges (/ideation) are structured collaboration on a community problem. An admin or member poses a challenge — \"How do we get more young people involved?\", \"What could we do with the empty community hall?\", \"How do we welcome refugees better?\" — and members contribute ideas, comment on each other's, upvote the best, and shortlist.\n\nFlow:\n1. Challenge posted with a clear question, background, criteria, deadline\n2. Idea submission phase — anyone can submit one or more ideas (title, description, optional image/file)\n3. Comment & refine phase — members discuss, suggest improvements\n4. Voting phase — members upvote the ideas they support\n5. Shortlist phase — the challenge owner picks finalists\n6. Outcome — what was chosen, why, what happens next\n\nThis differs from Polls (which is binary vote on fixed options) — Ideation is open-ended creative input.\n\nIdeation challenges can be public (whole community) or scoped to a Group/Organisation. They build engagement and surface ideas the admin team wouldn't have found alone.",
                'keywords' => ['ideation', 'idea', 'ideas', 'challenge', 'challenges', 'brainstorm', 'innovation', 'submit an idea', 'creative'],
            ],
            'organisations' => [
                'title' => 'Organisations — partner profiles',
                'body' => "Organisations (/organisations) are pages for partner bodies in the community — charities, social enterprises, council departments, schools, GP practices, faith groups, community centres.\n\nEach organisation has:\n• A public profile (about, contact, opening hours, location, photos, accreditations)\n• Volunteer opportunities they post (linked to the Volunteering module)\n• Events they run\n• A blog feed for their updates\n• A list of members involved (staff, volunteers, ambassadors)\n• A time-credit wallet (organisations can hold credits, receive donations from members, pay volunteers)\n\nWhy organisations? Communities work best when grassroots peer exchange (Listings) is woven together with structured organisational engagement (Volunteering, Events, partnerships). Organisations let formal bodies join the platform without losing their identity.\n\nFor org admins: a separate dashboard manages staff, volunteers, opportunities, the org wallet (deposit credits, pay volunteers, see audit history), the blog/news posts, public profile content.\n\nFor members: follow an organisation to see all their activity in your feed, browse their opportunities, donate hours to them as appreciation.",
                'keywords' => ['organisation', 'organisations', 'organization', 'organizations', 'org', 'charity', 'partner', 'partner organisation', 'ngo', 'social enterprise', 'council', 'school', 'church'],
            ],
            'group_exchanges' => [
                'title' => 'Group exchanges — many-to-many time projects',
                'body' => "Group Exchanges (/group-exchanges) are larger collaborative projects where multiple members work together towards a shared outcome and split the time credits — distinct from one-to-one Listings.\n\nExamples: a community garden build (5 members, 4 hours each), painting a community hall (3 members across 2 weekends), running a school holiday camp (8 volunteers across 5 days), translating a community document into 4 languages.\n\nHow it works:\n1. A coordinator creates the project: title, description, total hours budget, who contributes what\n2. Members sign on as contributors with planned hours\n3. Optional 'beneficiary' — the org/person receiving the value\n4. Project runs; coordinator marks completion and confirms each contributor's actual hours\n5. Credits distribute automatically: contributors earn from the beneficiary (or from a community pool if there's no single beneficiary)\n\nThis turns the platform from purely peer-to-peer into a tool for community projects that need coordinated effort. Great for capital projects, festivals, mutual aid responses, and translation/accessibility work.",
                'keywords' => ['group exchange', 'group exchanges', 'project', 'team project', 'collaborative', 'collaboration', 'work party', 'community project'],
            ],
            'federation' => [
                'title' => 'Federation — connecting communities',
                'body' => "Federation lets your community connect with other timebank communities on the same platform — so members can find skills, events, and exchanges across the wider network, not just within their own community.\n\nWhat federation enables (each toggle is independent, set by community admins):\n• Appear in the public directory of communities\n• Allow members to view federated profiles in other communities\n• Allow direct messaging across communities\n• Allow time-credit transactions across communities\n• Allow cross-community listings to appear in search\n• Allow cross-community events to be discoverable\n• Allow members of other communities to join your groups\n\nFor members: when federation is on, search results include matches from federated communities (clearly labelled with the community name). You can message and exchange with members elsewhere, and credits flow across communities seamlessly.\n\nFor admins: federation is opt-in per feature. Settings → Federation. Each community decides what to share. Whitelist mode lets you restrict to specific partner communities. Audit log tracks every cross-community transaction.\n\nThe federated network is a major reason this platform exists — small isolated timebanks struggle; connected ones thrive.",
                'keywords' => ['federation', 'federated', 'federate', 'network', 'other communities', 'cross-community', 'inter-community', 'directory'],
            ],
            'gamification' => [
                'title' => 'Gamification — badges, XP, and recognition',
                'body' => "If gamification is enabled, the platform recognises members' contributions with badges, levels, achievements, and a leaderboard. It's intended as gentle encouragement and visible appreciation — not competition for its own sake.\n\nBadges: earned for specific accomplishments — \"First listing\", \"Helped 10 members\", \"Mentor\" (taught 5+ members), \"Event organiser\", \"Translator\", \"Streak — 6 months active\". Some are time-based, some skill-based, some role-based. Find them on /achievements.\n\nXP & levels: every meaningful action earns XP (post a listing, complete an exchange, attend an event, help a newcomer). XP accumulates into levels. Levels unlock cosmetic profile decoration and (in some communities) higher trust standing.\n\nLeaderboard (/leaderboard): shows top contributors by hours given, hours received, members helped, events attended, etc. Anonymised view available — members can opt out of the leaderboard if they prefer.\n\nVerification badges: public profile badges can show ordinary identity or community trust signals. Private safeguarding vetting confirmations are never public badges and are not exposed in profiles, search, leaderboards or gamification.\n\nAdmin config: tenant admins can disable gamification entirely, hide the leaderboard, customise badge thresholds, or design custom badges.",
                'keywords' => ['gamification', 'badge', 'badges', 'achievement', 'achievements', 'xp', 'level', 'levels', 'leaderboard', 'top contributor', 'reward'],
            ],
            'goals' => [
                'title' => 'Goals — personal & community targets',
                'body' => "Goals (/goals) let you set personal targets and track progress over time. Examples: \"Help 12 different members this year\", \"Give 50 hours\", \"Receive help 5 times\" (encouraged for shy newcomers), \"Attend 10 events\", \"Learn 1 new skill\".\n\nSetting a goal: /goals → 'New goal'. Pick a goal type (hours given/received, exchanges, members helped, events attended, custom), target value, deadline. Goals can be public (visible on your profile) or private.\n\nProgress: live progress bar updates automatically as you do things. You'll get encouraging notifications at 25%, 50%, 75%, and 100%.\n\nCommunity goals: admins can set platform-wide goals — \"1000 hours exchanged this quarter\", \"50 new members\", \"20 events attended\". A community progress bar shows on the homepage. Hitting community goals can trigger celebration badges for active members.\n\nWhy goals? They turn vague intentions into actionable trackable progress, and they encourage the receiving side of timebanking (which is often the harder side for newcomers).",
                'keywords' => ['goal', 'goals', 'target', 'targets', 'personal goal', 'community goal', 'milestone', 'progress', 'set a goal'],
            ],
            'connections' => [
                'title' => 'Connections — your network',
                'body' => "Connections (/connections) are the members you've explicitly chosen to follow or befriend. Like a social network's 'friends' list, scoped to your community.\n\nHow to connect: tap 'Connect' on a member's profile. Some communities have one-way 'follow' (no approval needed); others use two-way 'friendship' (request → accept).\n\nWhat connecting does:\n• Their posts and listings rank higher in your feed\n• You see their RSVPs to events\n• You may unlock private content they share with connections only\n• Quick message access from your connections list\n\nManage your connections: /connections → list of all connections, ability to message, unfollow/disconnect, mute (stay connected but hide from feed).\n\nPrivacy: you can set who can request to connect — anyone in your community, only members in the same group, only members you've exchanged with, or nobody. Settings → Privacy.\n\nNotifications: new connection requests notify you; you can accept, decline, or ignore. Declined requests are silent — the other person isn't told.",
                'keywords' => ['connection', 'connections', 'follow', 'friend', 'friends', 'network', 'add as friend', 'unfollow', 'disconnect'],
            ],
            'reviews' => [
                'title' => 'Reviews & ratings',
                'body' => "If reviews are enabled in your community, members can rate and review each other after an exchange — building trust and helping newcomers know who's reliable.\n\nWhen reviews happen: a few days after an exchange is recorded, both parties get a prompt to leave a review. It takes ~30 seconds — star rating (1–5) plus an optional short comment.\n\nWhat reviews show: on a member's profile, you'll see their average rating, number of reviews, and the most recent reviews (with the reviewer's name unless they chose anonymous). Detailed feedback helps members improve and helps others choose who to exchange with.\n\nFairness rules:\n• You can only review someone after an actual recorded exchange\n• You have 30 days to leave a review\n• Reviews can't be edited after 7 days (preserves authenticity)\n• Abusive or defamatory reviews can be reported and removed by admins\n• If a review feels unfair, you can post a public response\n\nReviews aren't mandatory — opting out is fine. Communities focused on vulnerable members often disable public reviews to avoid stigma.",
                'keywords' => ['review', 'reviews', 'rating', 'ratings', 'star rating', 'feedback', 'leave a review', 'rate'],
            ],
            'ai_chat' => [
                'title' => 'AI assistant — the chat button',
                'body' => "The AI assistant (the chat / Sparkles button) is a built-in helper that answers questions about the platform and your community. It has full knowledge of every feature and access to your community's specific configuration.\n\nWhat it can help with:\n• Explaining any feature (\"how do I post a listing?\", \"what's a time credit?\")\n• Finding members with a specific skill (\"who can help me with computers?\")\n• Finding listings / events / groups (\"any gardening offers nearby?\")\n• Walking you through workflows step-by-step (\"how do I set up 2FA?\")\n• Drafting messages, listings, or event descriptions for you\n• Translating content into your language\n• Summarising long discussions\n• Suggesting goals based on your activity\n\nWhat it won't do: it can't impersonate other members, won't share private message content, won't execute account-level actions without your confirmation (e.g. it won't delete data on its own).\n\nPrivacy: chats with the AI are private to you. Admins can see aggregated chat metrics (cost, popular topics) but not your specific conversations unless reported for abuse.\n\nYou can train it: community admins can edit per-tenant 'module docs' (under /admin/ai/module-docs) to ground the AI in your specific community's terminology, policies, and FAQs.",
                'keywords' => ['ai', 'ai chat', 'ai assistant', 'chatbot', 'assistant', 'ask the ai', 'help bot', 'sparkles', 'chat button'],
            ],
            'search' => [
                'title' => 'Search — finding anything',
                'body' => "Press Cmd+K (Mac) / Ctrl+K (Windows) anywhere to open universal search. Or tap the magnifying glass icon. Or go to /search.\n\nSearch covers: members (name, skill, bio), listings (offers/requests, all categories), events, groups, blog posts, KB articles, organisations, marketplace items.\n\nFilters: narrow results by type, location radius, date, language, category, federation (your community only / all federated communities), free vs paid, has-image, etc.\n\nSemantic search: search understands synonyms — \"car ride\" matches \"lift\", \"tutoring\" matches \"lessons\", \"gardening\" matches \"weeding\". Powered by an embedding-based search engine (Meilisearch) plus optional AI re-ranking.\n\nSaved searches: save a search like \"piano lessons within 10km\" and get notified when new matches appear.\n\nRecent searches: shown in the search overlay so you can quickly re-run a recent query.\n\nNo results? The AI assistant offers to refine the search or suggest related members/listings.",
                'keywords' => ['search', 'find', 'looking for', 'where is', 'how do i find', 'cmd k', 'ctrl k', 'discover'],
            ],
            'caring_community' => [
                'title' => 'Caring Community — support for vulnerable members',
                'body' => "If Caring Community is enabled in your tenant, the platform has extra features designed for communities supporting older adults, carers, people with disabilities, and those at risk of social isolation.\n\nFeatures include:\n• Wellbeing check-ins — regular automated check-in messages with a 'I'm OK / I need help' button. Missed check-ins alert designated buddies or admins.\n• Buddy system — members are paired with a regular check-in partner\n• Easy-mode UI — larger text, simpler navigation, voice-controlled posting\n• Trusted helper network — helpers arranged under the community's role-specific safeguarding process, without a public vetting badge\n• Carer support listings — special category for respite, befriending, transport to medical appointments\n• Family/carer view — a family member can have read-only access to their loved one's account with consent\n• Accessible event filtering — wheelchair-accessible, sensory-friendly, easy-language\n• Direct emergency contact in the menu\n\nAll Caring Community features respect dignity, consent, and privacy. Vulnerable adult declarations and safeguarding vetting confirmations are private to the member and authorised safeguarding decision-makers; Project NEXUS does not retain criminal-record certificates.",
                'keywords' => ['caring community', 'caring', 'vulnerable', 'older', 'elderly', 'isolation', 'lonely', 'carer', 'check in', 'wellbeing', 'disability', 'accessible'],
            ],
            'newsletter' => [
                'title' => 'Newsletter & email digests',
                'body' => "The community newsletter is a regular email summarising what's happening — new members, upcoming events, popular listings, completed exchanges (anonymised counts), community announcements, member stories.\n\nFrequency: usually weekly, occasionally monthly. Set by community admins.\n\nSubscribing: you're opted in by default if your account is active. Unsubscribe link is at the bottom of every newsletter, or in Settings → Notifications → Email → Newsletter.\n\nFor admins: there's a full newsletter editor under /admin/newsletter — design templates, schedule sends, segment recipients (e.g. only members in a specific group, only inactive members), preview, send a test, and view open/click stats.\n\nLanguage: newsletters render in the recipient's preferred language (the platform supports 11 languages with full email i18n).",
                'keywords' => ['newsletter', 'email digest', 'weekly email', 'unsubscribe', 'subscribe', 'email updates'],
            ],

            // ============================================================
            // ACCOUNT, SECURITY, PRIVACY
            // ============================================================
            'account_security' => [
                'title' => 'Account security — passwords, 2FA, passkeys',
                'body' => "Your account security options live under Settings → Account → Security.\n\nPassword: minimum 8 chars, mix of letters and numbers recommended. Change any time via Settings → Account → Change password. If you forget your password, use 'Forgot password?' on the login page — a reset link goes to your email.\n\nTwo-factor authentication (2FA): adds a second step at login. Choose:\n• Authenticator app (Google Authenticator, Authy, 1Password) — scan QR, enter the 6-digit code\n• SMS — text code to your phone (less secure but easier)\n• Email — code to your email (fallback)\nAlways save backup codes when setting up 2FA.\n\nPasskeys (Windows Hello, Touch ID, Face ID, hardware keys): the most secure & convenient option. Settings → Account → Passkeys → 'Add a passkey'. Follow the prompts on your device. Once set up, sign-in is one tap with your fingerprint or face — no password needed.\n\nActive sessions: see every device currently signed in. Revoke any you don't recognise. Settings → Account → Active sessions.\n\nIf you suspect your account is compromised: change password, revoke all sessions, enable 2FA if not already, contact your community admin.",
                'keywords' => ['password', 'change password', 'forgot password', 'reset password', '2fa', 'two factor', 'two-factor', 'authenticator', 'passkey', 'passkeys', 'windows hello', 'touch id', 'face id', 'security key', 'login', 'sign in', 'signin'],
            ],
            'privacy_data' => [
                'title' => 'Privacy & data rights (GDPR)',
                'body' => "Your data is yours. You have full rights to see it, export it, correct it, and delete it.\n\nWhat data we hold: profile info, listings/posts you've made, messages you've sent, exchange history, login records (for security), notification preferences. We do NOT hold: payment card data (no payments), passwords (only salted hashes), the content of messages between other members.\n\nExport: Settings → Privacy → Export my data. You get a downloadable archive (JSON + media) within 24 hours. GDPR Article 15 (right of access) and Article 20 (data portability).\n\nDelete: Settings → Privacy → Delete my account. Choose:\n• Soft delete — account hidden, can be restored within 30 days\n• Hard delete — permanently erase. After 30 days, recovery is impossible. We anonymise references to you in other members' history (your name becomes \"deleted user\")\n\nWhat we don't delete: tax/audit records required by law, content other members have built upon (e.g. their messages quoting yours stay theirs).\n\nCookies: see the Cookies page in the footer. Strictly necessary cookies are always on; analytics cookies require consent in EU.\n\nThird parties: we don't sell data. We use a few processors (cloud hosting, email delivery, push notifications) — full list in the Privacy Policy.\n\nQuestions or complaints: contact your community admin or use the Help page. EU/EEA members have the right to complain to your local Data Protection Authority.",
                'keywords' => ['privacy', 'gdpr', 'data', 'my data', 'export data', 'delete account', 'data protection', 'data rights', 'cookie', 'cookies', 'tracking'],
            ],
            'accessibility' => [
                'title' => 'Accessibility — themes, languages, assistive tech',
                'body' => "The platform is designed for WCAG 2.1 AA accessibility. Everything works with screen readers, keyboard navigation, voice control, and high contrast modes.\n\nThemes: Settings → Appearance. Light, dark, or follow-system. Dark mode reduces eye strain in low light; light mode is preferred by many in bright rooms. Some communities also offer an accessible high-contrast theme.\n\nFont size: Settings → Appearance → Text size. Small, medium, large, extra large.\n\nReduced motion: Settings → Appearance → Reduce motion. Disables non-essential animations for vestibular comfort.\n\nLanguages: 11 supported — English, Irish (Gaeilge), German (Deutsch), French (Français), Italian (Italiano), Portuguese (Português), Spanish (Español), Dutch (Nederlands), Polish (Polski), Japanese (日本語), Arabic (العربية) with full right-to-left support. Set yours in Settings → Language. The entire UI, emails, and notifications all render in your language.\n\nScreen readers: full ARIA labels and semantic HTML throughout. Tested with NVDA, JAWS, VoiceOver, TalkBack.\n\nKeyboard navigation: every interactive element reachable by Tab. Skip-to-content link at the top of every page. Cmd/Ctrl+K opens search anywhere.\n\nAlt text on images: contributors are prompted to add alt text. Where alt text is missing, the AI offers to generate it.\n\nAccessible Frontend (govuk-frontend): an alternative HTML-first UI is available at /accessible for users who prefer maximum accessibility / minimum JavaScript. Ask your community admin if it's enabled.",
                'keywords' => ['accessibility', 'a11y', 'screen reader', 'wcag', 'language', 'languages', 'theme', 'dark mode', 'light mode', 'font size', 'text size', 'reduce motion', 'high contrast', 'irish', 'gaeilge', 'rtl', 'arabic', 'translation'],
            ],
            'mobile_pwa' => [
                'title' => 'Mobile app & PWA',
                'body' => "The platform works fully on mobile through two paths:\n\n1. Progressive Web App (PWA) — the recommended way. On any phone:\n• Visit the site in your phone's browser\n• Tap the menu and 'Add to Home Screen' (iOS Safari) or 'Install App' (Android Chrome)\n• An icon appears on your home screen; the app opens full-screen with no browser bars\n• Works offline for cached content; queued actions sync when back online\n• Push notifications work like a native app\n\n2. Native app — the Expo / React Native client in mobile/ supports Android and iOS with native screens and device integrations. Check the Get the app page for current distribution links and platform availability.\n\nUpdates: PWAs auto-update silently within ~5 minutes of a deploy — no app store waiting. Native apps prompt to update via the store.\n\nPush notifications: enable them in Settings → Notifications → Push. iOS requires you to add the PWA to home screen first before push works (iOS 16.4+).\n\nIf the app feels stuck on an old version: pull down to refresh, or visit /api/sw-reset to do a full reset.",
                'keywords' => ['mobile', 'phone', 'app', 'pwa', 'install', 'home screen', 'ios', 'android', 'iphone', 'ipad', 'samsung', 'tablet', 'native app', 'push notification', 'offline'],
            ],
            'troubleshooting' => [
                'title' => 'Troubleshooting common issues',
                'body' => "If something isn't working, try these in order:\n\n1. Refresh the page (Cmd/Ctrl+R). 80% of weird issues are stale cache.\n2. Sign out and sign back in. Settings → Sign out.\n3. Clear browser cache. Settings → Privacy & security → Clear data (browser-specific). Or visit /api/sw-reset to reset the app's offline cache.\n4. Try a different browser. Chrome and Safari are best supported; Firefox and Edge also work.\n5. Check your internet connection. The offline banner at the top warns you if you're offline.\n6. Check if push notifications need re-enabling — iOS sometimes silently disables push after updates.\n\nCan't sign in?\n• Forgotten password — use 'Forgot password?' on the login page\n• Email not recognised — check the address you signed up with; try alternative emails\n• Account suspended — contact your community admin\n• 2FA code not working — clock drift can cause this; check your phone's time settings; use a backup code if needed\n\nCan't find a feature you used to see?\n• Your community admin may have disabled that feature\n• Or your role/permissions may have changed\n• Or the feature is now in a different menu — try search (Cmd/Ctrl+K)\n\nStill stuck? Use the AI chat button, the Help page (/help), or contact your community admin via the Contact link in the footer.",
                'keywords' => ['troubleshoot', 'not working', 'broken', 'cant login', 'cant sign in', 'error', 'bug', 'stuck', 'frozen', 'slow', 'refresh', 'clear cache', 'help me fix'],
            ],
            'admin_overview' => [
                'title' => 'For community admins',
                'body' => "If you're a community administrator, the Admin panel (/admin) is your control centre.\n\nKey areas:\n• Members — invite, approve, suspend, change roles\n• Listings & posts — moderate, edit, delete, feature\n• Events & groups — approve, manage attendance, archive\n• Reports & moderation queue — abuse reports, flagged content\n• Tenant features — toggle any feature on/off for your community\n• Branding — logo, colours, hero text, custom legal docs (Terms, Privacy, Cookies)\n• SEO — meta tags, sitemap, social cards\n• AI module docs (/admin/ai/module-docs) — train the AI assistant for your community\n• Newsletter — design, schedule, send\n• Federation — connect with other communities, set what to share\n• Analytics — member activity, listing engagement, exchange volume, retention, leaderboards\n• Audit log — every admin action recorded for accountability\n• Safeguarding — country presets, vetting requirements, vulnerable-adult options\n• Billing (where applicable) — community subscription, usage\n\nMost mutating actions are audited. The audit log (/admin/audit) shows actor, IP, action, before/after, and outcome.\n\nFor platform-level admins (super-admins managing multiple tenants): there's an extra layer at /super-admin (or wherever the platform admin route is configured) with tenant management, billing, federation, and platform-wide settings.",
                'keywords' => ['admin', 'administrator', 'admin panel', 'super admin', 'manage community', 'moderation', 'moderate', 'approve', 'suspend', 'role', 'permissions', 'analytics', 'reports'],
            ],
        ];
    }
}
