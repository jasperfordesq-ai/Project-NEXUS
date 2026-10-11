<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Core\TenantContext;
use App\Http\Middleware\RedactEventCalendarFeedSecret;
use App\I18n\LocaleContext;
use App\Models\User;
use App\Services\EventConfigurationService;
use App\Services\EventCalendarService;
use DateTimeImmutable;
use DateTimeInterface;
use DateTimeZone;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Response;
use Throwable;

/** Thin authenticated calendar API plus revocable personal subscription feeds. */
final class EventCalendarController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(private readonly EventCalendarService $calendars) {}

    public function index(): JsonResponse
    {
        $actor = $this->actor();
        $range = $this->range('calendar');
        if ($range instanceof JsonResponse) {
            return $range;
        }

        [$from, $until, $timezone] = $range;
        $items = array_map(
            $this->calendars->apiProjection(...),
            $this->calendars->projectionsForRange($actor, $from, $until),
        );

        return $this->respondWithData($items, [
            'range' => [
                'from' => $from->format('Y-m-d'),
                'to' => $until->format('Y-m-d'),
                'timezone' => $timezone,
            ],
            'identity_free' => true,
            'restricted_access_redacted' => true,
        ]);
    }

    public function tenantFeed(): Response|JsonResponse
    {
        $actor = $this->actor();
        $range = $this->range('tenant_feed');
        if ($range instanceof JsonResponse) {
            return $range;
        }

        [$from, $until] = $range;
        $items = $this->calendars->projectionsForRange($actor, $from, $until);
        $name = __('event_calendar.tenant_feed_name', [
            'tenant' => TenantContext::getName(),
        ]);

        return $this->calendarResponse(
            $this->calendars->renderFeed($items, $name),
            'events.ics',
        );
    }

    public function eventFeed(int $id): Response|JsonResponse
    {
        $projection = $this->calendars->projectionForEvent($this->actor(), $id);
        if ($projection === null) {
            return $this->respondNotFound(__('api.event_not_found'), 'EVENT_NOT_FOUND');
        }

        return $this->calendarResponse(
            $this->calendars->renderEvent($projection),
            'event-' . $id . '.ics',
        );
    }

    public function actions(int $id): JsonResponse
    {
        $projection = $this->calendars->projectionForEvent($this->actor(), $id);
        if ($projection === null) {
            return $this->respondNotFound(__('api.event_not_found'), 'EVENT_NOT_FOUND');
        }

        return $this->respondWithData($this->calendars->calendarActions($projection));
    }

    public function tokens(): JsonResponse
    {
        return $this->sensitiveJson($this->respondWithData(
            $this->calendars->listFeedTokens($this->actor(true)),
            ['secrets_returned' => false],
        ));
    }

    public function createToken(): JsonResponse
    {
        $label = request()->input('label');
        if ($label !== null && ! is_string($label)) {
            return $this->respondWithError(
                'EVENT_CALENDAR_LABEL_INVALID',
                __('event_calendar.label_invalid'),
                'label',
                422,
            );
        }
        if (is_string($label) && mb_strlen(trim($label)) > 100) {
            return $this->respondWithError(
                'EVENT_CALENDAR_LABEL_INVALID',
                __('event_calendar.label_invalid'),
                'label',
                422,
            );
        }

        try {
            return $this->sensitiveJson($this->respondWithData(
                $this->calendars->createFeedToken($this->actor(), $label),
                ['secret_shown_once' => true],
                201,
            ));
        } catch (\DomainException $exception) {
            if ($exception->getMessage() === 'event_calendar_token_limit') {
                return $this->respondWithError(
                    'EVENT_CALENDAR_TOKEN_LIMIT',
                    __('event_calendar.token_limit'),
                    null,
                    409,
                );
            }

            return $this->respondForbidden(
                __('api.forbidden'),
                'EVENT_CALENDAR_FORBIDDEN',
            );
        }
    }

    public function revokeToken(int $tokenId): JsonResponse
    {
        if (! $this->calendars->revokeFeedToken($this->actor(true), $tokenId)) {
            return $this->respondNotFound(
                __('event_calendar.token_not_found'),
                'EVENT_CALENDAR_TOKEN_NOT_FOUND',
            );
        }

        return $this->sensitiveJson($this->respondWithData(['revoked' => true]));
    }

    public function personalFeed(
        string $tenantSlug,
        #[\SensitiveParameter] string $secret,
    ): Response|JsonResponse
    {
        $capability = request()->attributes->get(RedactEventCalendarFeedSecret::ATTRIBUTE);
        if (! is_string($capability)) {
            return $this->feedNotFound();
        }
        $secret = $capability;
        $resolved = $this->calendars->resolveFeedToken($tenantSlug, $secret);
        if ($resolved === null) {
            return $this->feedNotFound();
        }

        return TenantContext::runForTenant(
            (int) $resolved['tenant']->getKey(),
            function () use ($resolved): Response|JsonResponse {
                try {
                    if (! TenantContext::hasFeature('events')) {
                        return $this->feedNotFound();
                    }
                    if (! (bool) app(EventConfigurationService::class)->value(
                        'calendar_feeds_enabled',
                        true,
                        (int) $resolved['tenant']->getKey(),
                    )) {
                        return $this->feedNotFound();
                    }
                } catch (Throwable) {
                    return $this->feedNotFound();
                }

                return LocaleContext::withLocale(
                    (string) $resolved['token']->getAttribute('locale'),
                    function () use ($resolved): Response|JsonResponse {
                        $range = $this->calendars->personalFeedRange();
                        $items = $this->calendars->personalProjections(
                            $resolved['user'],
                            $range[0],
                            $range[1],
                        );
                        $name = __('event_calendar.personal_feed_name');
                        $body = $this->calendars->renderFeed($items, $name);

                        // Recheck the revocation predicate after generation so
                        // a concurrent revoke cannot be served from this request.
                        if (! $this->calendars->markFeedTokenUsedIfActive(
                            $resolved['token'],
                        )) {
                            return $this->feedNotFound();
                        }

                        return $this->calendarResponse($body, 'my-events.ics');
                    },
                );
            },
        );
    }

    /**
     * @return array{DateTimeImmutable,DateTimeImmutable,string}|JsonResponse
     */
    private function range(string $purpose): array|JsonResponse
    {
        $timezone = $this->calendars->tenantTimezone();
        $zone = new DateTimeZone($timezone);
        $fromInput = request()->query('from');
        $toInput = request()->query('to');
        if (($fromInput === null) !== ($toInput === null)
            || ($fromInput !== null && ! is_string($fromInput))
            || ($toInput !== null && ! is_string($toInput))) {
            return $this->invalidRange();
        }

        if (is_string($fromInput) && is_string($toInput)) {
            $from = $this->strictDate($fromInput, $zone);
            $until = $this->strictDate($toInput, $zone);
            if ($from === null || $until === null) {
                return $this->invalidRange();
            }
        } else {
            $today = new DateTimeImmutable('today', $zone);
            if ($purpose === 'calendar') {
                $from = $today->modify('first day of this month');
                $until = $from->modify('first day of next month');
            } else {
                [$from, $until] = $this->calendars->tenantFeedRange();
            }
        }

        $maximumDays = $purpose === 'calendar'
            ? max(1, min(3660, (int) config(
                'events.calendar.max_range_days',
                366,
            )))
            : max(1, min(3660,
                max(0, (int) config('events.calendar.tenant_feed_past_days', 30))
                + max(1, (int) config('events.calendar.tenant_feed_future_days', 366)),
            ));
        $days = (int) $from->diff($until)->format('%r%a');
        if ($days <= 0 || $days > $maximumDays) {
            return $this->invalidRange();
        }

        return [$from, $until, $timezone];
    }

    private function actor(bool $allowManagementExit = false): User
    {
        $tenantId = TenantContext::currentId();
        abort_unless(
            $tenantId !== null
                && ($allowManagementExit
                    || (bool) app(EventConfigurationService::class)->value('calendar_feeds_enabled', true, $tenantId)),
            403,
            __('api.forbidden'),
        );
        $user = $tenantId === null
            ? null
            : User::withoutGlobalScopes()
                ->where('tenant_id', $tenantId)
                ->where('status', 'active')
                ->whereNull('deleted_at')
                ->find($this->requireUserId());
        abort_unless($user instanceof User, 403, __('api.forbidden'));

        return $user;
    }

    private function strictDate(string $value, DateTimeZone $zone): ?DateTimeImmutable
    {
        $value = trim($value);
        $date = DateTimeImmutable::createFromFormat('!Y-m-d', $value, $zone);
        $errors = DateTimeImmutable::getLastErrors();
        if (! $date instanceof DateTimeImmutable
            || (is_array($errors)
                && (($errors['warning_count'] ?? 0) > 0
                    || ($errors['error_count'] ?? 0) > 0))
            || $date->format('Y-m-d') !== $value) {
            return null;
        }

        return $date;
    }

    private function invalidRange(): JsonResponse
    {
        return $this->respondWithError(
            'EVENT_CALENDAR_RANGE_INVALID',
            __('event_calendar.range_invalid'),
            'from',
            422,
        );
    }

    private function feedNotFound(): JsonResponse
    {
        return response()->json([
            'errors' => [[
                'code' => 'EVENT_CALENDAR_FEED_NOT_FOUND',
                'message' => __('event_calendar.feed_not_found'),
            ]],
        ], 404, [
            'Cache-Control' => 'private, no-store, max-age=0',
            'Referrer-Policy' => 'no-referrer',
        ]);
    }

    private function calendarResponse(string $body, string $filename): Response
    {
        return response($body, 200, [
            'Content-Type' => 'text/calendar; charset=utf-8',
            'Content-Disposition' => 'attachment; filename="' . $filename . '"',
            'Cache-Control' => 'private, no-store, max-age=0',
            'Pragma' => 'no-cache',
            'Referrer-Policy' => 'no-referrer',
            'X-Content-Type-Options' => 'nosniff',
            'X-Robots-Tag' => 'noindex, nofollow',
        ]);
    }

    private function sensitiveJson(JsonResponse $response): JsonResponse
    {
        $response->headers->set('Cache-Control', 'private, no-store, max-age=0');
        $response->headers->set('Pragma', 'no-cache');
        $response->headers->set('Referrer-Policy', 'no-referrer');

        return $response;
    }
}
