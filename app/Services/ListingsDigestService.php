<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use App\Http\Controllers\Api\NotificationUnsubscribeController;
use App\I18n\LocaleContext;
use App\Services\ListingsDigest\ListingsDigestEmail;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * The offers & requests round-up: an email to members listing the offers and
 * requests posted in their community, as an incentive to come back and trade.
 *
 * Two ways it goes out:
 *  - automatically (runScheduled, daily cron) to each member whose own
 *    interval — weekly or monthly — has passed since their last round-up.
 *    It only ever contains listings that member has not been sent before and
 *    did not post themselves, and nothing is sent when there is nothing new.
 *  - on demand by a community admin (sendAllBatch, run by the queue job
 *    App\Jobs\SendListingsDigestNow): every current offer and
 *    request, to every member who has not turned the round-up off.
 *
 * How often: the community admin sets the community default
 * (tenant_settings `listings_digest.default_frequency`: weekly | monthly | off,
 * monthly when unset). A member can override it in their own settings
 * (users.notification_preferences `listings_digest_frequency`: default |
 * weekly | monthly) and switch it off (`email_listings_digest`, which is also
 * what the email's one-click unsubscribe flips).
 *
 * Every listing shown is recorded in listings_digest_sends; that table is both
 * the "never repeat" memory and the record of when a member was last sent one.
 */
class ListingsDigestService
{
    public const SETTING_KEY = 'listings_digest.default_frequency';
    public const PREF_ENABLED = 'email_listings_digest';
    public const PREF_FREQUENCY = 'listings_digest_frequency';
    public const MAIL_CATEGORY = 'listings_digest';
    public const UNSUBSCRIBE_CATEGORY = 'listings_digest';

    public const COMMUNITY_CHOICES = ['weekly', 'monthly', 'off'];
    public const MEMBER_CHOICES = ['default', 'weekly', 'monthly', 'off'];
    public const DEFAULT_FREQUENCY = 'monthly';

    /** @var array<string, int> */
    public const INTERVAL_DAYS = ['weekly' => 7, 'monthly' => 30];

    /** Cards per section (the spotlight is extra). */
    private const PER_SECTION = 4;

    /** The cron runs daily; allow a member to fall due a little early so a 7-day interval does not slip to 8. */
    private const DUE_TOLERANCE_HOURS = 6;

    private const EVENT_LIMIT = 3;
    private const EVENT_HORIZON_DAYS = 31;

    public function __construct(
        private readonly TenantSettingsService $tenantSettings,
    ) {}

    // =================================================================
    // Settings
    // =================================================================

    public function communityDefault(int $tenantId): string
    {
        $value = (string) $this->tenantSettings->get($tenantId, self::SETTING_KEY, self::DEFAULT_FREQUENCY);

        return in_array($value, self::COMMUNITY_CHOICES, true) ? $value : self::DEFAULT_FREQUENCY;
    }

    public function setCommunityDefault(int $tenantId, string $frequency): void
    {
        if (!in_array($frequency, self::COMMUNITY_CHOICES, true)) {
            throw new \InvalidArgumentException('Unknown round-up frequency: ' . $frequency);
        }
        $this->tenantSettings->set($tenantId, self::SETTING_KEY, $frequency);
    }

    /**
     * @return array{frequency: string, community_default: string, effective: string}
     */
    public function memberSettings(int $userId, int $tenantId): array
    {
        $raw = DB::table('users')
            ->where('id', $userId)
            ->where('tenant_id', $tenantId)
            ->value('notification_preferences');
        $prefs = self::decodePrefs($raw);
        $communityDefault = $this->communityDefault($tenantId);

        return [
            'frequency' => self::memberChoice($prefs),
            'community_default' => $communityDefault,
            'effective' => self::effectiveFrequency($prefs, $communityDefault),
        ];
    }

    /**
     * @return array{frequency: string, community_default: string, effective: string}
     */
    public function setMemberFrequency(int $userId, int $tenantId, string $choice): array
    {
        if (!in_array($choice, self::MEMBER_CHOICES, true)) {
            throw new \InvalidArgumentException('Unknown round-up choice: ' . $choice);
        }

        DB::transaction(function () use ($userId, $tenantId, $choice): void {
            // Same row lock as the settings form and the unsubscribe link, so
            // concurrent writers to the preference JSON cannot lose each other.
            $raw = DB::table('users')
                ->where('id', $userId)
                ->where('tenant_id', $tenantId)
                ->lockForUpdate()
                ->value('notification_preferences');
            $prefs = self::decodePrefs($raw);

            if ($choice === 'off') {
                $prefs[self::PREF_ENABLED] = false;
            } else {
                $prefs[self::PREF_ENABLED] = true;
                $prefs[self::PREF_FREQUENCY] = $choice;
            }

            DB::table('users')
                ->where('id', $userId)
                ->where('tenant_id', $tenantId)
                ->update([
                    'notification_preferences' => json_encode($prefs, JSON_THROW_ON_ERROR),
                    'updated_at' => now(),
                ]);
        });

        return $this->memberSettings($userId, $tenantId);
    }

    /** What the member chose: default | weekly | monthly | off. */
    public static function memberChoice(array $prefs): string
    {
        if (!self::isEnabled($prefs)) {
            return 'off';
        }
        $frequency = (string) ($prefs[self::PREF_FREQUENCY] ?? 'default');

        return in_array($frequency, ['weekly', 'monthly'], true) ? $frequency : 'default';
    }

    /** What actually applies to the member: weekly | monthly | off. */
    public static function effectiveFrequency(array $prefs, string $communityDefault): string
    {
        $choice = self::memberChoice($prefs);
        if ($choice === 'off') {
            return 'off';
        }

        return $choice === 'default' ? $communityDefault : $choice;
    }

    private static function isEnabled(array $prefs): bool
    {
        $value = $prefs[self::PREF_ENABLED] ?? true;

        return $value !== false && (int) $value !== 0;
    }

    /** @return array<string, mixed> */
    private static function decodePrefs(mixed $raw): array
    {
        $prefs = is_string($raw) ? json_decode($raw, true) : null;

        return is_array($prefs) ? $prefs : [];
    }

    // =================================================================
    // Sending
    // =================================================================

    /**
     * Daily cron entry point: every active community with listings switched on.
     *
     * @return array{tenants: int, sent: int, skipped_empty: int, failed: int}
     */
    public function runScheduled(?CarbonImmutable $now = null): array
    {
        $now ??= CarbonImmutable::now();
        $stats = ['tenants' => 0, 'sent' => 0, 'skipped_empty' => 0, 'failed' => 0];
        $previousTenantId = TenantContext::currentId();

        try {
            $tenantIds = DB::table('tenants')->where('is_active', 1)->orderBy('id')->pluck('id');
            foreach ($tenantIds as $tenantId) {
                try {
                    if (!TenantContext::setById((int) $tenantId) || !self::listingsEnabled()) {
                        continue;
                    }
                    $stats['tenants']++;
                    $result = $this->sendForTenant((int) $tenantId, 'new', $now);
                    $stats['sent'] += $result['sent'];
                    $stats['skipped_empty'] += $result['skipped_empty'];
                    $stats['failed'] += $result['failed'];
                } catch (\Throwable $e) {
                    $stats['failed']++;
                    Log::error('ListingsDigest: tenant run failed', ['tenant_id' => $tenantId, 'error' => $e->getMessage()]);
                }
            }
        } finally {
            if ($previousTenantId !== null) {
                TenantContext::setById($previousTenantId);
            } else {
                TenantContext::reset();
            }
        }

        return $stats;
    }

    /**
     * The automatic round-up for one community: everyone who is due. The
     * caller must already be in that tenant's context.
     *
     * @return array{sent: int, skipped_empty: int, failed: int, last_user_id: int, done: bool}
     */
    public function sendDueForTenant(int $tenantId, ?CarbonImmutable $now = null): array
    {
        return $this->sendForTenant($tenantId, 'new', $now ?? CarbonImmutable::now());
    }

    /**
     * One batch of an admin's "send everything now": members after $afterUserId,
     * at most $limit of them. The queue job (App\Jobs\SendListingsDigestNow)
     * walks the whole community batch by batch so no single job runs long.
     *
     * @return array{sent: int, skipped_empty: int, failed: int, last_user_id: int, done: bool}
     */
    public function sendAllBatch(int $tenantId, int $afterUserId, int $limit, CarbonImmutable $now): array
    {
        return $this->sendForTenant($tenantId, 'all', $now, $afterUserId, $limit);
    }

    /** Members an admin send would reach (the round-up is not switched off for them). */
    public function countRecipients(int $tenantId): int
    {
        $communityDefault = $this->communityDefault($tenantId);
        $count = 0;
        $this->eachEligibleMember($tenantId, function (object $member, array $prefs) use ($communityDefault, &$count): void {
            if ($this->wantsAdminSend($prefs, $communityDefault)) {
                $count++;
            }
        });

        return $count;
    }

    /**
     * Render the email as a given member would get it, without sending or
     * recording anything — the admin preview.
     *
     * The viewer is the admin who asked, already authorised for $tenantId by
     * the caller. They need not be a member of it: a global super admin, or a
     * tenant super admin managing a community below its own, has its home
     * elsewhere. Only the viewer's own name, language and preferences are read
     * from their account; every listing still comes from $tenantId.
     */
    public function preview(int $tenantId, int $viewerId, string $mode = 'all', ?CarbonImmutable $now = null): ?string
    {
        $now ??= CarbonImmutable::now();
        $member = DB::table('users')
            ->where('id', $viewerId)
            ->first(['id', 'email', 'first_name', 'last_name', 'profile_type', 'organization_name', 'preferred_language', 'notification_preferences']);
        if ($member === null) {
            return null;
        }
        $candidates = $mode === 'all' ? $this->allCandidates($tenantId, $now) : $this->recentCandidates($tenantId, $now);
        $frequency = $mode === 'all' ? null : self::effectiveFrequency(self::decodePrefs($member->notification_preferences), $this->communityDefault($tenantId));
        $windowStart = $mode === 'all' ? null : $now->subDays(self::INTERVAL_DAYS[$frequency] ?? 30);

        $selection = $this->selectFor($tenantId, $member, $candidates, $windowStart, $mode === 'new', $now);
        // A preview always shows something, even if this admin has seen it all.
        if ($selection['shown'] === [] && $mode === 'new') {
            $selection = $this->selectFor($tenantId, $member, $this->allCandidates($tenantId, $now), null, false, $now);
        }

        return LocaleContext::withLocale($member, fn (): string => $this->renderFor($tenantId, $member, $selection, $mode, $frequency === 'off' ? null : $frequency, $now));
    }

    /**
     * The newsletter "{{recent_listings}}" block: the newest offers and
     * requests, rendered in the caller's current locale.
     */
    public function newsletterBlock(int $tenantId, int $perSection = self::PER_SECTION): string
    {
        $now = CarbonImmutable::now();
        $items = array_map(fn (object $row): array => $this->toItem($row), $this->allCandidates($tenantId, $now));
        $offers = array_slice(array_values(array_filter($items, static fn (array $i): bool => $i['type'] === 'offer')), 0, $perSection);
        $requests = array_slice(array_values(array_filter($items, static fn (array $i): bool => $i['type'] === 'request')), 0, $perSection);

        return ListingsDigestEmail::renderListingsBlock($offers, $requests, self::brandColour(), [
            'offers' => self::url('/listings?type=offer'),
            'requests' => self::url('/listings?type=request'),
        ]);
    }

    /**
     * @return array{sent: int, skipped_empty: int, failed: int, last_user_id: int, done: bool}
     */
    private function sendForTenant(int $tenantId, string $mode, CarbonImmutable $now, int $afterUserId = 0, ?int $limit = null): array
    {
        $result = ['sent' => 0, 'skipped_empty' => 0, 'failed' => 0, 'last_user_id' => $afterUserId, 'done' => true];
        $communityDefault = $this->communityDefault($tenantId);
        $candidates = $mode === 'all' ? $this->allCandidates($tenantId, $now) : $this->recentCandidates($tenantId, $now);
        if ($candidates === []) {
            return $result;
        }

        $visited = $this->eachEligibleMember($tenantId, function (object $member, array $prefs) use ($tenantId, $mode, $now, $communityDefault, $candidates, &$result): void {
            $result['last_user_id'] = (int) $member->id;
            if ($mode === 'all') {
                if (!$this->wantsAdminSend($prefs, $communityDefault)) {
                    return;
                }
                $frequency = null;
                $windowStart = null;
            } else {
                $frequency = self::effectiveFrequency($prefs, $communityDefault);
                if ($frequency === 'off') {
                    return;
                }
                $interval = self::INTERVAL_DAYS[$frequency];
                $lastSent = $this->lastSentAt($tenantId, (int) $member->id);
                if ($lastSent !== null && $lastSent->greaterThan($now->subDays($interval)->addHours(self::DUE_TOLERANCE_HOURS))) {
                    return;
                }
                $floor = $now->subDays($interval);
                $windowStart = ($lastSent !== null && $lastSent->greaterThan($floor)) ? $lastSent : $floor;
            }

            $selection = $this->selectFor($tenantId, $member, $candidates, $windowStart, $mode === 'new', $now);
            if ($selection['shown'] === []) {
                $result['skipped_empty']++;

                return;
            }

            try {
                $sent = LocaleContext::withLocale($member, function () use ($tenantId, $member, $selection, $mode, $frequency, $now): bool {
                    $html = $this->renderFor($tenantId, $member, $selection, $mode, $frequency, $now);
                    $total = $selection['offer_total'] + $selection['request_total'];
                    $subject = (string) __(
                        'emails_listings.listings_digest.' . ($mode === 'all' ? 'subject_all' : 'subject_new') . ($total === 1 ? '_one' : '_other'),
                        ['count' => $total, 'community' => self::communityName()],
                    );

                    return EmailDispatchService::sendRaw(
                        (string) $member->email,
                        $subject,
                        $html,
                        null,
                        null,
                        NotificationUnsubscribeController::buildSignedUrl((int) $member->id, $tenantId, self::UNSUBSCRIBE_CATEGORY),
                        self::MAIL_CATEGORY,
                        ['tenant_id' => $tenantId, 'user_id' => (int) $member->id, 'source' => 'ListingsDigestService'],
                    );
                });
            } catch (\Throwable $e) {
                Log::warning('ListingsDigest: send failed', ['tenant_id' => $tenantId, 'user_id' => $member->id, 'error' => $e->getMessage()]);
                $sent = false;
            }

            if (!$sent) {
                $result['failed']++;

                return;
            }

            $this->recordShown($tenantId, (int) $member->id, $selection['shown'], $now);
            $result['sent']++;
        }, $afterUserId, $limit);

        $result['done'] = $limit === null || $visited < $limit;

        return $result;
    }

    /** An admin send reaches everyone who has not switched the round-up off. */
    private function wantsAdminSend(array $prefs, string $communityDefault): bool
    {
        return self::memberChoice($prefs) !== 'off';
    }

    /**
     * Active, approved members of the tenant with an email address, in id
     * order, optionally only those after $afterUserId and at most $limit.
     *
     * @param callable(object, array<string, mixed>): void $fn
     * @return int how many members were visited
     */
    private function eachEligibleMember(int $tenantId, callable $fn, int $afterUserId = 0, ?int $limit = null): int
    {
        $query = DB::table('users')
            ->where('tenant_id', $tenantId)
            ->where('status', 'active')
            ->where('is_approved', 1)
            ->whereNotNull('email')
            ->where('email', '!=', '')
            ->where('id', '>', $afterUserId)
            ->select(['id', 'email', 'first_name', 'last_name', 'profile_type', 'organization_name', 'preferred_language', 'notification_preferences']);

        $visited = 0;
        if ($limit !== null) {
            foreach ($query->orderBy('id')->limit($limit)->get() as $member) {
                $fn($member, self::decodePrefs($member->notification_preferences));
                $visited++;
            }

            return $visited;
        }

        $query->orderBy('id')->chunkById(500, function ($members) use ($fn, &$visited): void {
            foreach ($members as $member) {
                $fn($member, self::decodePrefs($member->notification_preferences));
                $visited++;
            }
        });

        return $visited;
    }

    private function lastSentAt(int $tenantId, int $userId): ?CarbonImmutable
    {
        $value = DB::table('listings_digest_sends')
            ->where('tenant_id', $tenantId)
            ->where('user_id', $userId)
            ->max('sent_at');

        return $value !== null ? CarbonImmutable::parse((string) $value) : null;
    }

    /** @param list<int> $listingIds */
    private function recordShown(int $tenantId, int $userId, array $listingIds, CarbonImmutable $now): void
    {
        $rows = array_map(static fn (int $id): array => [
            'tenant_id' => $tenantId,
            'user_id' => $userId,
            'listing_id' => $id,
            'sent_at' => $now->toDateTimeString(),
        ], $listingIds);

        // An admin send can show a listing the member was already sent; the
        // newer sent_at then moves their next automatic round-up along.
        DB::table('listings_digest_sends')->upsert($rows, ['tenant_id', 'user_id', 'listing_id'], ['sent_at']);
    }

    // =================================================================
    // Content
    // =================================================================

    /**
     * Listings a member could be shown, before per-member filtering. Same
     * visibility rule as every other member-facing read
     * (ListingService::applyPublicVisibility), plus: not expired, and the
     * person who posted it is still an active member of this community.
     */
    private function baseQuery(int $tenantId, CarbonImmutable $now): \Illuminate\Database\Query\Builder
    {
        return DB::table('listings as l')
            ->join('users as u', function ($join) {
                $join->on('u.id', '=', 'l.user_id')->on('u.tenant_id', '=', 'l.tenant_id');
            })
            ->leftJoin('categories as c', function ($join) {
                $join->on('c.id', '=', 'l.category_id')->on('c.tenant_id', '=', 'l.tenant_id');
            })
            ->where('l.tenant_id', $tenantId)
            ->whereIn('l.type', ['offer', 'request'])
            ->whereNull('l.deleted_at')
            ->where(function ($q) {
                $q->whereNull('l.status')->orWhere('l.status', 'active');
            })
            ->where(function ($q) {
                $q->whereNull('l.moderation_status')->orWhere('l.moderation_status', 'approved');
            })
            ->where(function ($q) use ($now) {
                $q->whereNull('l.expires_at')->orWhere('l.expires_at', '>', $now->toDateTimeString());
            })
            ->where('u.status', 'active')
            ->select([
                'l.id', 'l.user_id', 'l.type', 'l.title', 'l.description', 'l.image_url', 'l.hours_estimate', 'l.category_id',
                'l.is_featured', 'l.featured_until', 'l.created_at',
                'c.name as category_name',
                'u.first_name', 'u.profile_type', 'u.organization_name',
            ]);
    }

    /** @return list<object> */
    private function recentCandidates(int $tenantId, CarbonImmutable $now): array
    {
        // Two intervals back covers every member's window; per-member filtering narrows it.
        return $this->baseQuery($tenantId, $now)
            ->where('l.created_at', '>=', $now->subDays(self::INTERVAL_DAYS['monthly'] * 2)->toDateTimeString())
            ->orderByDesc('l.created_at')
            ->limit(500)
            ->get()
            ->all();
    }

    /** @return list<object> */
    private function allCandidates(int $tenantId, CarbonImmutable $now): array
    {
        return $this->baseQuery($tenantId, $now)
            ->orderByDesc('l.created_at')
            ->limit(500)
            ->get()
            ->all();
    }

    /**
     * Narrow the candidates to what this member gets: not their own, nobody
     * they blocked or who blocked them, inside their window, and (for the
     * automatic round-up) nothing they were sent before.
     *
     * @param list<object> $candidates
     * @return array{spotlight: ?array<string, mixed>, offers: list<array<string, mixed>>, requests: list<array<string, mixed>>, offer_total: int, request_total: int, shown: list<int>}
     */
    private function selectFor(int $tenantId, object $member, array $candidates, ?CarbonImmutable $windowStart, bool $excludeSent, CarbonImmutable $now): array
    {
        $memberId = (int) $member->id;
        $blocked = $this->blockedOwnerIds($tenantId, $memberId);
        $alreadySent = [];
        if ($excludeSent && $candidates !== []) {
            $alreadySent = array_flip(DB::table('listings_digest_sends')
                ->where('tenant_id', $tenantId)
                ->where('user_id', $memberId)
                ->whereIn('listing_id', array_map(static fn (object $r): int => (int) $r->id, $candidates))
                ->pluck('listing_id')
                ->map(static fn ($id): int => (int) $id)
                ->all());
        }

        $kept = [];
        foreach ($candidates as $row) {
            if ((int) $row->user_id === $memberId || isset($blocked[(int) $row->user_id]) || isset($alreadySent[(int) $row->id])) {
                continue;
            }
            if ($windowStart !== null && CarbonImmutable::parse((string) $row->created_at)->lessThan($windowStart)) {
                continue;
            }
            $kept[] = $row;
        }

        $offerTotal = count(array_filter($kept, static fn (object $r): bool => $r->type === 'offer'));
        $requestTotal = count($kept) - $offerTotal;

        $spotlightIndex = null;
        foreach ($kept as $i => $row) {
            $featured = (int) $row->is_featured === 1
                && ($row->featured_until === null || CarbonImmutable::parse((string) $row->featured_until)->greaterThan($now));
            if ($featured) {
                $spotlightIndex = $i;
                break;
            }
        }
        if ($spotlightIndex === null) {
            foreach ($kept as $i => $row) {
                if (!empty($row->image_url)) {
                    $spotlightIndex = $i;
                    break;
                }
            }
        }
        if ($spotlightIndex === null && $kept !== [] && count($kept) > 2) {
            $spotlightIndex = 0;
        }

        $spotlight = null;
        if ($spotlightIndex !== null) {
            $spotlight = $this->toItem($kept[$spotlightIndex], true);
            unset($kept[$spotlightIndex]);
        }

        $offers = [];
        $requests = [];
        foreach ($kept as $row) {
            if ($row->type === 'offer' && count($offers) < self::PER_SECTION) {
                $offers[] = $this->toItem($row);
            } elseif ($row->type === 'request' && count($requests) < self::PER_SECTION) {
                $requests[] = $this->toItem($row);
            }
        }

        $shown = array_map(static fn (array $i): int => (int) $i['id'], array_merge($spotlight !== null ? [$spotlight] : [], $offers, $requests));

        return [
            'spotlight' => $spotlight,
            'offers' => $offers,
            'requests' => $requests,
            'offer_total' => $offerTotal,
            'request_total' => $requestTotal,
            'shown' => $shown,
        ];
    }

    /** @return array<int, true> owner ids hidden from this member either way round */
    private function blockedOwnerIds(int $tenantId, int $memberId): array
    {
        try {
            $rows = DB::table('user_blocks')
                ->where(function ($q) use ($tenantId) {
                    $q->where('tenant_id', $tenantId)->orWhereNull('tenant_id');
                })
                ->where(function ($q) use ($memberId) {
                    $q->where('user_id', $memberId)->orWhere('blocked_user_id', $memberId);
                })
                ->get(['user_id', 'blocked_user_id']);
        } catch (\Throwable $e) {
            // A missing block list must never widen what a member is shown:
            // fail the send for this member rather than ignore blocks.
            throw new \RuntimeException('Could not read member blocks: ' . $e->getMessage(), 0, $e);
        }

        $ids = [];
        foreach ($rows as $row) {
            $other = (int) $row->user_id === $memberId ? (int) $row->blocked_user_id : (int) $row->user_id;
            $ids[$other] = true;
        }

        return $ids;
    }

    /** @return array<string, mixed> */
    private function toItem(object $row, bool $withDetail = false): array
    {
        $author = ($row->profile_type ?? null) === 'organisation' && !empty($row->organization_name)
            ? (string) $row->organization_name
            : trim((string) ($row->first_name ?? ''));

        $hours = null;
        if ($row->hours_estimate !== null && (float) $row->hours_estimate > 0) {
            $value = rtrim(rtrim(number_format((float) $row->hours_estimate, 2, '.', ''), '0'), '.');
            $hours = (string) __(
                'emails_listings.listings_digest.' . ((float) $row->hours_estimate === 1.0 ? 'hours_one' : 'hours_other'),
                ['count' => $value],
            );
        }

        $item = [
            'id' => (int) $row->id,
            'type' => (string) $row->type,
            'title' => (string) $row->title,
            // In this member's language: items are rendered per member inside LocaleContext.
            'category' => $row->category_name !== null
                ? \App\Services\Translation\TaxonomyNameLocalizer::nameFor('categories', $row->category_id ?? null, (string) $row->category_name)
                : null,
            'author' => $author,
            'hours' => $hours,
            'url' => self::url('/listings/' . (int) $row->id),
        ];

        if ($withDetail) {
            $item['excerpt'] = self::excerpt((string) ($row->description ?? ''));
            $item['image'] = !empty($row->image_url) ? self::assetUrl((string) $row->image_url) : null;
        }

        return $item;
    }

    /** @return list<array<string, string>> */
    private function upcomingEvents(int $tenantId, CarbonImmutable $now): array
    {
        if (!self::featureOn('events')) {
            return [];
        }

        try {
            $rows = DB::table('events')
                ->where('tenant_id', $tenantId)
                ->whereNull('group_id')
                ->where(function ($q) {
                    $q->whereNull('parent_event_id')->orWhere('parent_event_id', 0);
                })
                ->where(function ($q) {
                    $q->whereNull('status')->orWhere('status', 'active');
                })
                ->where(function ($q) {
                    $q->where('publication_status', 'published')->orWhereNull('publication_status');
                })
                ->where(function ($q) {
                    $q->whereNull('operational_status')->orWhere('operational_status', 'scheduled');
                })
                ->where('start_time', '>', $now->toDateTimeString())
                ->where('start_time', '<', $now->addDays(self::EVENT_HORIZON_DAYS)->toDateTimeString())
                ->orderBy('start_time')
                ->limit(self::EVENT_LIMIT)
                ->get(['id', 'title', 'start_time', 'location', 'is_online']);
        } catch (\Throwable $e) {
            Log::warning('ListingsDigest: could not read events', ['tenant_id' => $tenantId, 'error' => $e->getMessage()]);

            return [];
        }

        $locale = app()->getLocale() ?: 'en';
        $events = [];
        foreach ($rows as $row) {
            $start = CarbonImmutable::parse((string) $row->start_time)->locale($locale);
            $where = (int) $row->is_online === 1
                ? (string) __('emails_listings.listings_digest.online')
                : trim((string) ($row->location ?? ''));
            $events[] = [
                'title' => (string) $row->title,
                'url' => self::url('/events/' . (int) $row->id),
                'month' => $start->translatedFormat('M'),
                'day' => $start->format('j'),
                'when' => trim($start->translatedFormat('D H:i') . ($where !== '' ? ' · ' . $where : '')),
            ];
        }

        return $events;
    }

    /**
     * @param array{spotlight: ?array<string, mixed>, offers: list<array<string, mixed>>, requests: list<array<string, mixed>>, offer_total: int, request_total: int, shown: list<int>} $selection
     */
    private function renderFor(int $tenantId, object $member, array $selection, string $mode, ?string $frequency, CarbonImmutable $now): string
    {
        $firstName = trim((string) ($member->first_name ?? ''));
        if (($member->profile_type ?? null) === 'organisation' && !empty($member->organization_name)) {
            $firstName = (string) $member->organization_name;
        }
        $locale = app()->getLocale() ?: 'en';

        return ListingsDigestEmail::render([
            'mode' => $mode,
            'recipient_name' => $firstName,
            'community' => self::communityName(),
            'brand' => self::brandColour(),
            'logo_url' => self::logoUrl(),
            'header_label' => (string) __('emails_listings.listings_digest.header_label', [
                'month' => $now->locale($locale)->translatedFormat('F'),
            ]),
            'spotlight' => $selection['spotlight'],
            'offers' => $selection['offers'],
            'requests' => $selection['requests'],
            'offer_total' => $selection['offer_total'],
            'request_total' => $selection['request_total'],
            'events' => $this->upcomingEvents($tenantId, $now),
            'urls' => [
                'browse' => self::url('/listings'),
                'offers' => self::url('/listings?type=offer'),
                'requests' => self::url('/listings?type=request'),
                'post_offer' => self::url('/listings/create?type=offer'),
                'ask_help' => self::url('/listings/create?type=request'),
                'settings' => self::url('/settings?tab=notifications'),
                'unsubscribe' => NotificationUnsubscribeController::buildSignedUrl((int) $member->id, $tenantId, self::UNSUBSCRIBE_CATEGORY),
            ],
            'frequency' => $frequency,
            'rtl' => str_starts_with($locale, 'ar'),
        ]);
    }

    // =================================================================
    // Tenant helpers
    // =================================================================

    private static function listingsEnabled(): bool
    {
        try {
            return TenantContext::hasModule('listings');
        } catch (\Throwable) {
            return false;
        }
    }

    private static function featureOn(string $feature): bool
    {
        try {
            return (bool) TenantContext::hasFeature($feature);
        } catch (\Throwable) {
            return false;
        }
    }

    private static function communityName(): string
    {
        $name = (string) (TenantContext::get()['name'] ?? '');

        return $name !== '' ? $name : (string) __('emails.common.fallback_tenant_name');
    }

    private static function brandColour(): ?string
    {
        $colour = trim((string) TenantContext::getSetting('primary_color', ''));

        return preg_match('/^#[0-9a-fA-F]{6}$/', $colour) === 1 ? $colour : null;
    }

    private static function logoUrl(): ?string
    {
        $logo = trim((string) TenantContext::getSetting('logo_url', ''));
        if ($logo === '') {
            return null;
        }
        return self::assetUrl($logo);
    }

    /**
     * An uploaded file as an https address a mail client can load. Relative
     * /uploads paths go to the community's own web address (the same host the
     * email's links use), which serves uploads; UrlHelper::absolute() would
     * fall back to the sales site for a community without its own domain.
     */
    private static function assetUrl(string $path): ?string
    {
        $path = trim($path);
        if (preg_match('#^https://#i', $path) === 1) {
            return $path;
        }
        if (!str_starts_with($path, '/') || str_starts_with($path, '//')) {
            return null;
        }
        $url = rtrim(TenantContext::getFrontendUrl(), '/') . $path;

        return str_starts_with($url, 'https://') ? $url : null;
    }

    private static function url(string $path): string
    {
        return TenantContext::getFrontendUrl() . TenantContext::getSlugPrefix() . $path;
    }

    private static function excerpt(string $text, int $max = 180): string
    {
        $plain = trim((string) preg_replace('/\s+/u', ' ', html_entity_decode(strip_tags($text), ENT_QUOTES | ENT_HTML5, 'UTF-8')));
        if (mb_strlen($plain) <= $max) {
            return $plain;
        }
        $cut = mb_substr($plain, 0, $max);
        $space = mb_strrpos($cut, ' ');

        return rtrim($space !== false && $space > $max * 0.6 ? mb_substr($cut, 0, $space) : $cut, " ,.;:") . '…';
    }
}
