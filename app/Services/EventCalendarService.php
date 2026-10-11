<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use App\Core\EmailTemplateBuilder;
use App\Core\TenantContext;
use App\Enums\EventOperationalState;
use App\Enums\EventPublicationState;
use App\Helpers\IcsHelper;
use App\Models\Event;
use App\Models\EventCalendarFeedToken;
use App\Models\Tenant;
use App\Models\User;
use App\Policies\EventPolicy;
use Carbon\CarbonImmutable;
use DateTimeImmutable;
use DateTimeInterface;
use DateTimeZone;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Sabre\VObject\Component;
use Sabre\VObject\Component\VCalendar;
use Sabre\VObject\Reader;
use Throwable;

/** Privacy-safe calendar projection, export, subscription, and reconciliation boundary. */
final class EventCalendarService
{
    private const UID_DOMAIN = 'events.project-nexus.ie';

    /** @var list<string> */
    private const SUPPORTED_LOCALES = [
        'en', 'ga', 'de', 'fr', 'it', 'pt', 'es', 'nl', 'pl', 'ja', 'ar',
    ];

    public function __construct(
        private readonly EventPolicy $policy,
        private readonly TenantSettingsService $settings,
    ) {}

    public function tenantTimezone(): string
    {
        $tenantId = (int) TenantContext::getId();
        $timezone = trim((string) $this->settings->get(
            $tenantId,
            'general.timezone',
            config('app.timezone', 'UTC'),
        ));
        try {
            return (new DateTimeZone($timezone !== '' ? $timezone : 'UTC'))->getName();
        } catch (Throwable) {
            return 'UTC';
        }
    }

    /** @return array{DateTimeImmutable,DateTimeImmutable,string} */
    public function tenantFeedRange(): array
    {
        $timezone = $this->tenantTimezone();
        $today = CarbonImmutable::now($timezone)->startOfDay()->toDateTimeImmutable();
        $past = max(0, min(3660, (int) config(
            'events.calendar.tenant_feed_past_days',
            30,
        )));
        $future = max(1, min(3660, (int) config(
            'events.calendar.tenant_feed_future_days',
            366,
        )));

        return [
            $today->modify('-' . $past . ' days'),
            $today->modify('+' . $future . ' days'),
            $timezone,
        ];
    }

    /** @return array{DateTimeImmutable,DateTimeImmutable} */
    public function personalFeedRange(): array
    {
        $timezone = $this->tenantTimezone();
        $today = CarbonImmutable::now($timezone)->startOfDay()->toDateTimeImmutable();
        $past = max(0, min(3660, (int) config(
            'events.calendar.personal_feed_past_days',
            365,
        )));
        $future = max(1, min(3660, (int) config(
            'events.calendar.personal_feed_future_days',
            730,
        )));

        return [
            $today->modify('-' . $past . ' days'),
            $today->modify('+' . $future . ' days'),
        ];
    }

    /**
     * @return list<array<string, int|string|bool|null>>
     */
    public function projectionsForRange(
        User $viewer,
        DateTimeInterface $from,
        DateTimeInterface $until,
    ): array {
        return $this->visibleProjections(
            $viewer,
            $this->publishedCandidates($viewer, $from, $until),
        );
    }

    /**
     * Return registered events without exposing the subscription owner's identity.
     *
     * @return list<array<string, int|string|bool|null>>
     */
    public function personalProjections(
        User $viewer,
        DateTimeInterface $from,
        DateTimeInterface $until,
    ): array {
        $tenantId = $this->validTenantFor($viewer);
        if ($tenantId === null) {
            return [];
        }

        $eventIds = [];
        $canonicalDefaultSubjects = [];
        $defaultPool = trim((string) config(
            'events.registration.default_capacity_pool_key',
            'event',
        )) ?: 'event';
        try {
            if (Schema::hasTable('event_registrations')) {
                $canonicalRows = DB::table('event_registrations')
                    ->where('tenant_id', $tenantId)
                    ->where('user_id', (int) $viewer->getKey())
                    ->get(['event_id', 'capacity_pool_key', 'registration_state']);
                foreach ($canonicalRows as $row) {
                    $eventId = (int) $row->event_id;
                    if ((string) $row->capacity_pool_key === $defaultPool) {
                        $canonicalDefaultSubjects[$eventId] = true;
                    }
                    if ((string) $row->registration_state === 'confirmed') {
                        $eventIds[] = $eventId;
                    }
                }
            }
            if (Schema::hasTable('event_rsvps')) {
                $legacyEventIds = DB::table('event_rsvps')
                    ->where('tenant_id', $tenantId)
                    ->where('user_id', (int) $viewer->getKey())
                    ->whereIn('status', ['going', 'attended'])
                    ->pluck('event_id')
                    ->map(static fn (mixed $eventId): int => (int) $eventId)
                    ->all();
                foreach ($legacyEventIds as $eventId) {
                    if (! isset($canonicalDefaultSubjects[$eventId])) {
                        $eventIds[] = $eventId;
                    }
                }
            }
        } catch (Throwable) {
            // Ambiguous registration state must not populate a private feed.
            return [];
        }

        $eventIds = array_values(array_unique(array_filter(
            $eventIds,
            static fn (int $eventId): bool => $eventId > 0,
        )));
        if ($eventIds === []) {
            return [];
        }

        return $this->visibleProjections(
            $viewer,
            $this->publishedCandidates($viewer, $from, $until, $eventIds),
        );
    }

    /** @return array<string, int|string|bool|null>|null */
    public function projectionForEvent(User $viewer, int $eventId): ?array
    {
        $tenantId = $this->validTenantFor($viewer);
        if ($tenantId === null) {
            return null;
        }

        /** @var Event|null $event */
        $event = Event::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->whereKey($eventId)
            ->first();
        if ($event === null || (bool) $event->getAttribute('is_recurring_template')) {
            return null;
        }

        $abilities = $this->policy->abilitiesForEvents($viewer, [$event]);
        if (! ($abilities[$eventId]['view'] ?? false)) {
            return null;
        }

        return $this->project($event);
    }

    /**
     * @param list<array<string, int|string|bool|null>> $projections
     */
    public function renderFeed(array $projections, string $calendarName): string
    {
        $calendar = new VCalendar([
            'VERSION' => '2.0',
            'PRODID' => '-//Nexus//Timebank Platform//EN',
            'CALSCALE' => 'GREGORIAN',
            'METHOD' => 'PUBLISH',
            'X-WR-CALNAME' => $calendarName,
        ], false);

        /** @var array<string, true> $timezones */
        $timezones = [];
        foreach ($projections as $projection) {
            $document = Reader::read($this->renderEvent($projection));
            if (! $document instanceof Component) {
                continue;
            }

            foreach ($document->select('VTIMEZONE') as $timezone) {
                $timezoneId = isset($timezone->TZID) ? (string) $timezone->TZID : '';
                if ($timezoneId === '' || isset($timezones[$timezoneId])) {
                    continue;
                }
                $calendar->add(clone $timezone);
                $timezones[$timezoneId] = true;
            }
            foreach ($document->select('VEVENT') as $event) {
                $calendar->add(clone $event);
            }
        }

        return $calendar->serialize();
    }

    /**
     * Remove reconciliation-only material before returning a JSON collection.
     *
     * @param array<string, int|string|bool|null> $projection
     * @return array<string, int|string|bool|null>
     */
    public function apiProjection(array $projection): array
    {
        unset($projection['uid_seed']);

        return $projection;
    }

    /** @param array<string, int|string|bool|null> $projection */
    public function renderEvent(array $projection): string
    {
        $detailUrl = is_string($projection['detail_url'] ?? null)
            ? $projection['detail_url']
            : null;

        return IcsHelper::generateIcs(
            (string) $projection['title'],
            (string) $projection['description'],
            (string) $projection['starts_at'],
            is_string($projection['ends_at'] ?? null)
                ? $projection['ends_at']
                : null,
            [
                'timezone' => (string) $projection['timezone'],
                'all_day' => (bool) $projection['all_day'],
                'uid_seed' => (string) $projection['uid_seed'],
                'uid_domain' => self::UID_DOMAIN,
                'dtstamp' => (string) $projection['updated_at'],
                'sequence' => (int) $projection['sequence'],
                'operational_status' => (string) $projection['operational_status'],
                'public_url' => $detailUrl,
                'include_public_url' => $detailUrl !== null,
                // Restricted locations and meeting links are deliberately absent.
                'include_location' => false,
                'include_online_access' => false,
            ],
        );
    }

    /**
     * Google and Outlook links are derived from the same canonical projection
     * used for ICS, so dates, title, safe description, and lifecycle stay aligned.
     *
     * @param array<string, int|string|bool|null> $projection
     * @return array{google_url:string,outlook_url:string,download_path:string}
     */
    public function calendarActions(array $projection): array
    {
        $allDay = (bool) $projection['all_day'];
        $start = new DateTimeImmutable((string) $projection['starts_at']);
        $end = new DateTimeImmutable((string) $projection['ends_at']);
        $googleDates = $allDay
            ? $start->format('Ymd') . '/' . $end->format('Ymd')
            : $start->setTimezone(new DateTimeZone('UTC'))->format('Ymd\THis\Z')
                . '/' . $end->setTimezone(new DateTimeZone('UTC'))->format('Ymd\THis\Z');

        $googleQuery = [
            'action' => 'TEMPLATE',
            'text' => (string) $projection['title'],
            'dates' => $googleDates,
            'details' => (string) $projection['description'],
        ];
        if (! $allDay) {
            $googleQuery['stz'] = (string) $projection['timezone'];
            $googleQuery['etz'] = (string) $projection['timezone'];
        }

        $outlookQuery = [
            'path' => '/calendar/action/compose',
            'rru' => 'addevent',
            'subject' => (string) $projection['title'],
            'startdt' => $allDay
                ? $start->format('Y-m-d') . 'T00:00:00'
                : $start->format(DateTimeInterface::ATOM),
            'enddt' => $allDay
                ? $end->format('Y-m-d') . 'T00:00:00'
                : $end->format(DateTimeInterface::ATOM),
            'body' => (string) $projection['description'],
        ];
        if ($allDay) {
            $outlookQuery['allday'] = 'true';
        }

        return [
            'google_url' => 'https://calendar.google.com/calendar/r/eventedit?'
                . http_build_query($googleQuery, '', '&', PHP_QUERY_RFC3986),
            'outlook_url' => 'https://outlook.office.com/calendar/deeplink/compose/?'
                . http_build_query($outlookQuery, '', '&', PHP_QUERY_RFC3986),
            'download_path' => '/v2/events/' . (int) $projection['id'] . '/calendar.ics',
        ];
    }

    /** @return array<string, int|string|bool|null> */
    public function createFeedToken(User $viewer, ?string $label): array
    {
        $tenantId = $this->validTenantFor($viewer);
        if ($tenantId === null) {
            throw new \DomainException('event_calendar_forbidden');
        }
        $maximum = max(1, min(100, (int) config(
            'events.calendar.max_active_feed_tokens',
            10,
        )));
        $locale = strtolower(trim((string) $viewer->getAttribute('preferred_language')));
        if (! in_array($locale, self::SUPPORTED_LOCALES, true)) {
            $locale = 'en';
        }
        $cleanLabel = is_string($label) && trim($label) !== ''
            ? mb_substr(trim($label), 0, 100)
            : null;
        [$token, $secret] = DB::transaction(function () use (
            $viewer,
            $tenantId,
            $maximum,
            $locale,
            $cleanLabel,
        ): array {
            // The durable member row is the per-tenant/user mutex. Concurrent
            // creates therefore cannot both observe the same token count.
            $ownerExists = DB::table('users')
                ->where('tenant_id', $tenantId)
                ->where('id', (int) $viewer->getKey())
                ->where('status', 'active')
                ->whereNull('deleted_at')
                ->lockForUpdate()
                ->exists();
            if (! $ownerExists) {
                throw new \DomainException('event_calendar_forbidden');
            }

            $activeCount = EventCalendarFeedToken::withoutGlobalScopes()
                ->where('tenant_id', $tenantId)
                ->where('user_id', (int) $viewer->getKey())
                ->whereNull('revoked_at')
                ->count();
            if ($activeCount >= $maximum) {
                throw new \DomainException('event_calendar_token_limit');
            }

            $secret = 'nxc_' . bin2hex(random_bytes(32));
            /** @var EventCalendarFeedToken $token */
            $token = EventCalendarFeedToken::withoutGlobalScopes()->create([
                'tenant_id' => $tenantId,
                'user_id' => (int) $viewer->getKey(),
                'token_hash' => hash('sha256', $secret),
                'token_prefix' => substr($secret, 0, 12),
                'label' => $cleanLabel,
                'locale' => $locale,
            ]);

            return [$token, $secret];
        }, 3);

        $tenantSlug = (string) Tenant::query()->whereKey($tenantId)->value('slug');
        $feedPath = '/api/v2/events/calendar/personal/'
            . rawurlencode($tenantSlug)
            . '/'
            . rawurlencode($secret)
            . '.ics';

        return array_merge($this->serializeToken($token), [
            // The secret and URL are only returned by this creation call.
            'secret' => $secret,
            'feed_url' => rtrim(request()->getSchemeAndHttpHost(), '/') . $feedPath,
        ]);
    }

    /** @return list<array<string, int|string|bool|null>> */
    public function listFeedTokens(User $viewer): array
    {
        $tenantId = $this->validTenantFor($viewer);
        if ($tenantId === null) {
            return [];
        }

        return EventCalendarFeedToken::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->where('user_id', (int) $viewer->getKey())
            ->orderByDesc('id')
            ->limit(50)
            ->get()
            ->map(fn (EventCalendarFeedToken $token): array => $this->serializeToken($token))
            ->values()
            ->all();
    }

    /** @return array<string, int|string|bool|null>|null */
    public function feedTokenForOwner(User $viewer, int $tokenId): ?array
    {
        $tenantId = $this->validTenantFor($viewer);
        if ($tenantId === null || $tokenId <= 0) {
            return null;
        }

        $token = EventCalendarFeedToken::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->where('user_id', (int) $viewer->getKey())
            ->whereKey($tokenId)
            ->first();

        return $token instanceof EventCalendarFeedToken
            ? $this->serializeToken($token)
            : null;
    }

    public function revokeFeedToken(User $viewer, int $tokenId): bool
    {
        $tenantId = $this->validTenantFor($viewer);
        if ($tenantId === null) {
            return false;
        }

        return EventCalendarFeedToken::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->where('user_id', (int) $viewer->getKey())
            ->whereKey($tokenId)
            ->whereNull('revoked_at')
            ->update(['revoked_at' => now(), 'updated_at' => now()]) === 1;
    }

    /**
     * @return array{tenant:Tenant,token:EventCalendarFeedToken,user:User}|null
     */
    public function resolveFeedToken(string $tenantSlug, string $secret): ?array
    {
        if (preg_match('/^[a-z0-9][a-z0-9-]{0,99}$/D', $tenantSlug) !== 1
            || preg_match('/^nxc_[a-f0-9]{64}$/D', $secret) !== 1) {
            return null;
        }

        $tenant = Tenant::query()
            ->where('slug', $tenantSlug)
            ->where('is_active', 1)
            ->first();
        if (! $tenant instanceof Tenant) {
            return null;
        }

        $token = EventCalendarFeedToken::withoutGlobalScopes()
            ->where('tenant_id', (int) $tenant->getKey())
            ->where('token_hash', hash('sha256', $secret))
            ->whereNull('revoked_at')
            ->first();
        if (! $token instanceof EventCalendarFeedToken) {
            return null;
        }

        $user = User::withoutGlobalScopes()
            ->where('tenant_id', (int) $tenant->getKey())
            ->where('status', 'active')
            ->whereNull('deleted_at')
            ->whereKey((int) $token->getAttribute('user_id'))
            ->first();
        if (! $user instanceof User) {
            return null;
        }

        return ['tenant' => $tenant, 'token' => $token, 'user' => $user];
    }

    public function markFeedTokenUsedIfActive(EventCalendarFeedToken $token): bool
    {
        return EventCalendarFeedToken::withoutGlobalScopes()
            ->whereKey((int) $token->getKey())
            ->where('tenant_id', (int) $token->getAttribute('tenant_id'))
            ->whereNull('revoked_at')
            ->update(['last_used_at' => now(), 'updated_at' => now()]) === 1;
    }

    /**
     * @param list<int>|null $eventIds
     * @return Collection<int, Event>
     */
    private function publishedCandidates(
        User $viewer,
        DateTimeInterface $from,
        DateTimeInterface $until,
        ?array $eventIds = null,
    ): Collection {
        $tenantId = $this->validTenantFor($viewer);
        if ($tenantId === null || $until <= $from) {
            return collect();
        }

        $query = Event::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->where(static function ($publication): void {
                $publication->where('publication_status', EventPublicationState::Published->value)
                    ->orWhere(static function ($legacy): void {
                        $legacy->whereNull('publication_status')
                            ->whereIn('status', ['active', 'cancelled', 'completed']);
                    });
            })
            ->where(static function ($template): void {
                $template->whereNull('is_recurring_template')
                    ->orWhere('is_recurring_template', 0);
            })
            ->where('start_time', '<', $this->utcDatabaseDate($until));
        $fromUtc = $this->utcDatabaseDate($from);
        $query->where(static function ($overlap) use ($fromUtc): void {
                $overlap->where('end_time', '>', $fromUtc)
                    ->orWhere(static function ($instant) use ($fromUtc): void {
                        $instant->whereNull('end_time')
                            ->where('start_time', '>=', $fromUtc);
                    });
            });
        if ($eventIds !== null) {
            $query->whereIn('id', $eventIds);
        }

        return $query->orderBy('start_time')->orderBy('id')->get();
    }

    /**
     * @param Collection<int, Event> $events
     * @return list<array<string, int|string|bool|null>>
     */
    private function visibleProjections(User $viewer, Collection $events): array
    {
        $abilities = $this->policy->abilitiesForEvents($viewer, $events);

        return $events
            ->filter(static fn (Event $event): bool => $abilities[(int) $event->getKey()]['view'] ?? false)
            ->map(fn (Event $event): array => $this->project($event))
            ->values()
            ->all();
    }

    /** @return array<string, int|string|bool|null> */
    private function project(Event $event): array
    {
        $timezone = $this->validTimezone((string) $event->getRawOriginal('timezone'));
        $zone = new DateTimeZone($timezone);
        $utc = new DateTimeZone('UTC');
        $start = (new DateTimeImmutable(
            (string) $event->getRawOriginal('start_time'),
            $utc,
        ))->setTimezone($zone);
        $endRaw = $event->getRawOriginal('end_time');
        $allDay = (bool) $event->getAttribute('all_day');
        $end = is_string($endRaw) && trim($endRaw) !== ''
            ? (new DateTimeImmutable($endRaw, $utc))->setTimezone($zone)
            : ($allDay ? $start->modify('+1 day') : $start->modify('+1 hour'));
        if ($end <= $start) {
            $end = $allDay ? $start->modify('+1 day') : $start->modify('+1 hour');
        }

        $detailUrl = EmailTemplateBuilder::tenantUrl('/events/' . (int) $event->getKey());
        if (filter_var($detailUrl, FILTER_VALIDATE_URL) === false) {
            $detailUrl = null;
        }
        $description = $detailUrl !== null
            ? __('event_calendar.description', ['url' => $detailUrl])
            : __('event_calendar.description_without_url');
        $updatedRaw = $event->getRawOriginal('updated_at')
            ?: $event->getRawOriginal('created_at')
            ?: $event->getRawOriginal('start_time');
        $updated = new DateTimeImmutable((string) $updatedRaw, $utc);
        $operational = $this->operationalState($event);
        $uidSeed = implode('|', [
            'event',
            (string) $event->getAttribute('tenant_id'),
            (string) $event->getKey(),
            (string) ($event->getRawOriginal('occurrence_key') ?: 'concrete'),
        ]);

        return [
            'id' => (int) $event->getKey(),
            'uid' => substr(hash('sha256', $uidSeed), 0, 40) . '@' . self::UID_DOMAIN,
            'uid_seed' => $uidSeed,
            'title' => (string) $event->getAttribute('title'),
            'description' => $description,
            'starts_at' => $allDay ? $start->format('Y-m-d') : $start->format(DateTimeInterface::ATOM),
            'ends_at' => $allDay ? $end->format('Y-m-d') : $end->format(DateTimeInterface::ATOM),
            'timezone' => $timezone,
            'all_day' => $allDay,
            'operational_status' => $operational->value,
            'calendar_status' => $operational === EventOperationalState::Cancelled
                ? 'cancelled'
                : ($operational === EventOperationalState::Postponed ? 'tentative' : 'confirmed'),
            'sequence' => max(0, (int) $event->getRawOriginal('calendar_sequence'))
                + max(0, (int) $event->getRawOriginal('lifecycle_version')),
            'updated_at' => $updated->setTimezone($utc)->format(DateTimeInterface::ATOM),
            'detail_url' => $detailUrl,
        ];
    }

    private function operationalState(Event $event): EventOperationalState
    {
        $operational = $event->getRawOriginal('operational_status');
        if (is_string($operational)) {
            $state = EventOperationalState::tryFrom($operational);
            if ($state !== null) {
                return $state;
            }
        }

        try {
            return EventOperationalState::fromLegacyStatus(
                is_string($event->getRawOriginal('status'))
                    ? $event->getRawOriginal('status')
                    : null,
            );
        } catch (Throwable) {
            return EventOperationalState::Cancelled;
        }
    }

    private function validTenantFor(User $viewer): ?int
    {
        $tenantId = TenantContext::currentId();
        if ($tenantId === null
            || $tenantId <= 0
            || (int) $viewer->getKey() <= 0
            || (int) $viewer->getAttribute('tenant_id') !== $tenantId
            || (string) $viewer->getAttribute('status') !== 'active'
            || $viewer->getAttribute('deleted_at') !== null) {
            return null;
        }

        try {
            return TenantContext::hasFeature('events') ? $tenantId : null;
        } catch (Throwable) {
            return null;
        }
    }

    private function validTimezone(string $timezone): string
    {
        $timezone = trim($timezone);
        try {
            return (new DateTimeZone($timezone !== '' ? $timezone : 'UTC'))->getName();
        } catch (Throwable) {
            return 'UTC';
        }
    }

    private function utcDatabaseDate(DateTimeInterface $date): string
    {
        return DateTimeImmutable::createFromInterface($date)
            ->setTimezone(new DateTimeZone('UTC'))
            ->format('Y-m-d H:i:s');
    }

    /** @return array<string, int|string|bool|null> */
    private function serializeToken(EventCalendarFeedToken $token): array
    {
        return [
            'id' => (int) $token->getKey(),
            'label' => $token->getAttribute('label'),
            'token_prefix' => (string) $token->getAttribute('token_prefix'),
            'locale' => (string) $token->getAttribute('locale'),
            'created_at' => $token->getAttribute('created_at')?->toAtomString(),
            'last_used_at' => $token->getAttribute('last_used_at')?->toAtomString(),
            'revoked_at' => $token->getAttribute('revoked_at')?->toAtomString(),
            'active' => $token->getAttribute('revoked_at') === null,
        ];
    }
}
