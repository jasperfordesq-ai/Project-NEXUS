<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Services\EventService;
use Illuminate\Http\JsonResponse;
use Illuminate\Validation\ValidationException;

/**
 * EventPublicController — read-only events for anonymous visitors.
 *
 * Exists so a community can advertise what is on without requiring an account.
 * Registration still requires login; nothing here exposes a write path.
 *
 * 🔴 The projection below is an ALLOWLIST, deliberately built field by field
 * rather than by stripping keys from the member DTO. The member serializer
 * grows over time, and a denylist would silently start publishing whatever was
 * added to it next. Anything not named here is not served to the public —
 * notably RSVP/attendance state, attendee lists and counts, online joining
 * links, organiser contact details, safety and agenda internals.
 *
 * Gated by BOTH `events` and `public_events`, so a community that has events
 * but has not opted into public advertising is unaffected.
 */
class EventPublicController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(
        private readonly EventService $eventService,
    ) {}

    /**
     * GET /api/v2/public/events
     */
    public function index(): JsonResponse
    {
        $this->rateLimit('public_events_index', 60, 60);

        $when = $this->query('when', 'upcoming');
        if (! in_array($when, ['upcoming', 'past', 'all'], true)) {
            $when = 'upcoming';
        }

        $filters = [
            'limit' => $this->queryInt('per_page', 20, 1, 50),
            // Anonymous visitors get the "what's on" view by default; a public
            // page that opened on past events would read as a dead listing.
            'when' => $when,
            'viewer_id' => null,
            'public_only' => true,
        ];

        if ($this->query('category_id') !== null) {
            $filters['category_id'] = $this->query('category_id');
        }
        if ($this->query('q') !== null) {
            $filters['search'] = $this->query('q');
        }
        if ($this->query('cursor') !== null) {
            $filters['cursor'] = $this->query('cursor');
        }

        try {
            $result = $this->eventService->getAll($filters);
        } catch (ValidationException $exception) {
            return $this->discoveryValidationResponse($exception);
        }

        $items = array_map(
            fn (array $event): array => $this->publicProjection($event),
            $result['items'],
        );

        return $this->respondWithCollection(
            $items,
            $result['cursor'],
            $filters['limit'],
            $result['has_more'],
        );
    }

    /**
     * GET /api/v2/public/events/{id}
     */
    public function show(int $id): JsonResponse
    {
        $this->rateLimit('public_events_show', 60, 60);

        $event = EventService::getPublicById($id);

        if ($event === null) {
            // Same 404 for "does not exist" and "not publicly visible", so the
            // endpoint cannot be used to probe for private or draft events.
            return $this->respondWithError('NOT_FOUND', __('api.event_not_found'), null, 404);
        }

        return $this->respondWithData($this->publicProjection($event, true));
    }

    /**
     * Mirrors EventsController::discoveryValidationResponse — a bad cursor or
     * filter is a 422 naming the field, not a 500.
     */
    private function discoveryValidationResponse(ValidationException $exception): JsonResponse
    {
        $errors = $exception->errors();
        $field = array_key_first($errors);
        $message = $field !== null && isset($errors[$field][0])
            ? (string) $errors[$field][0]
            : __('api.invalid_cursor');

        return $this->respondWithError('VALIDATION_ERROR', $message, $field, 422);
    }

    /**
     * Build the public view of an event.
     *
     * Delegates to the shared allowlist so the accessible frontend's What's On
     * pages and this API can never drift apart on what is public.
     *
     * @param  array<string, mixed>  $event
     * @return array<string, mixed>
     */
    private function publicProjection(array $event, bool $detail = false): array
    {
        return \App\Support\Events\PublicEventProjection::project($event, $detail);
    }
}
