{{-- Copyright (c) 2024-2026 Jasper Ford --}}
{{-- SPDX-License-Identifier: AGPL-3.0-or-later --}}
{{-- Author: Jasper Ford --}}
{{-- See NOTICE file for attribution and acknowledgements. --}}
@extends('accessible-frontend::layout')

@section('content')
    <p class="govuk-body">
        <a class="govuk-link" href="{{ route('govuk-alpha.events.calendar.actions', ['tenantSlug' => $tenantSlug, 'id' => $event['id']]) }}">
            {{ __('govuk_alpha.events.calendar_actions_title') }}
        </a>
        <span aria-hidden="true"> · </span>
        <a class="govuk-link" href="{{ route('govuk-alpha.events.agenda', ['tenantSlug' => $tenantSlug, 'id' => $event['id']]) }}">
            {{ __('govuk_alpha.events.agenda_link') }}
        </a>
        <span aria-hidden="true"> · </span>
        <a class="govuk-link" href="{{ route('govuk-alpha.events.safety', ['tenantSlug' => $tenantSlug, 'id' => $event['id']]) }}">
            {{ __('event_safety.govuk.link') }}
        </a>
        <span aria-hidden="true"> · </span>
        <a class="govuk-link" href="{{ route('govuk-alpha.events.tickets.index', ['tenantSlug' => $tenantSlug, 'id' => $event['id']]) }}">
            {{ __('event_tickets.title') }}
        </a>
    </p>
    @php
        $schedule = is_array($event['schedule'] ?? null) ? $event['schedule'] : [];
        $timezone = (string) ($schedule['timezone'] ?? 'UTC');
        $formatDateTime = static fn ($value): ?string => $value
            ? \Illuminate\Support\Carbon::parse($value)->setTimezone($timezone)->translatedFormat('j F Y, g:ia T')
            : null;
        $isAllDay = (bool) ($schedule['all_day'] ?? false);
        if ($isAllDay) {
            $startDate = isset($schedule['start_at'])
                ? \Illuminate\Support\Carbon::parse($schedule['start_at'])->setTimezone($timezone)
                : null;
            $exclusiveEnd = isset($schedule['end_at'])
                ? \Illuminate\Support\Carbon::parse($schedule['end_at'])->setTimezone($timezone)
                : null;
            $inclusiveEnd = $exclusiveEnd !== null
                && $startDate !== null
                && $exclusiveEnd->gt($startDate)
                ? $exclusiveEnd->copy()->subDay()
                : null;
            $start = $startDate?->translatedFormat('j F Y');
            $end = $inclusiveEnd !== null
                && $startDate !== null
                && !$inclusiveEnd->isSameDay($startDate)
                ? $inclusiveEnd->translatedFormat('j F Y')
                : null;
        } else {
            $start = $formatDateTime($schedule['start_at'] ?? null);
            $end = $formatDateTime($schedule['end_at'] ?? null);
        }
        $categoryName = $event['category']['name'] ?? null;
        $organiserName = (string) ($event['organizer']['display_name'] ?? '');
        $locationFacts = is_array($event['location'] ?? null) ? $event['location'] : [];
        $venueAccessibility = is_array($locationFacts['accessibility'] ?? null)
            ? $locationFacts['accessibility']
            : [];
        $relationship = is_array($event['relationship'] ?? null) ? $event['relationship'] : [];
        $engagementState = (string) ($relationship['engagement']['state'] ?? 'none');
        $registrationState = (string) ($relationship['registration']['state'] ?? 'none');
        $attendanceState = (string) ($relationship['attendance']['state'] ?? 'not_checked_in');
        $onlineAccess = is_array($event['online_access'] ?? null) ? $event['online_access'] : [];
        $metrics = is_array($event['metrics'] ?? null) ? $event['metrics'] : [];
        $currentRsvp = match (true) {
            $registrationState === 'confirmed' => 'going',
            in_array($registrationState, ['declined', 'cancelled'], true) => 'not_going',
            $engagementState === 'interested' => 'interested',
            default => null,
        };
        $primaryImage = $event['primary_image']['url'] ?? null;
        $publicationState = (string) ($schedule['publication_state'] ?? 'published');
        $operationalState = (string) ($schedule['operational_state'] ?? $schedule['state'] ?? 'scheduled');
        $isCancelled = $operationalState === 'cancelled';
        $isArchived = $publicationState === 'archived';
    @endphp

    <a class="govuk-back-link" href="{{ route('govuk-alpha.events.index', ['tenantSlug' => $tenantSlug]) }}">{{ __('govuk_alpha.actions.back_to_events') }}</a>

    @if ($registrationState === 'confirmed')
        <p class="govuk-body">
            <a class="govuk-link" href="{{ route('govuk-alpha.events.reminders', ['tenantSlug' => $tenantSlug, 'id' => $event['id']]) }}">
                {{ __('govuk_alpha_events.reminders.manage_link') }}
            </a>
            <span aria-hidden="true"> · </span>
            <a class="govuk-link" href="{{ route('govuk-alpha.events.check-in.credential', ['tenantSlug' => $tenantSlug, 'id' => $event['id']]) }}">
                {{ __('event_offline_checkin.attendee.manage_link') }}
            </a>
        </p>
    @endif

    @if ($status === 'event-created')
        <div class="govuk-notification-banner govuk-notification-banner--success" data-module="govuk-notification-banner" role="alert" aria-labelledby="event-created-title">
            <div class="govuk-notification-banner__header">
                <h2 class="govuk-notification-banner__title" id="event-created-title">{{ __('govuk_alpha.states.success_title') }}</h2>
            </div>
            <div class="govuk-notification-banner__content">
                <p class="govuk-notification-banner__heading">{{ __('govuk_alpha.events.created') }}</p>
            </div>
        </div>
    @elseif ($status === 'rsvp-updated')
        <div class="govuk-notification-banner govuk-notification-banner--success" data-module="govuk-notification-banner" role="alert" aria-labelledby="rsvp-success-title">
            <div class="govuk-notification-banner__header">
                <h2 class="govuk-notification-banner__title" id="rsvp-success-title">{{ __('govuk_alpha.states.success_title') }}</h2>
            </div>
            <div class="govuk-notification-banner__content">
                <p class="govuk-notification-banner__heading">{{ __('govuk_alpha.events.rsvp_updated') }}</p>
            </div>
        </div>
    @elseif (in_array($status, ['event-updated', 'event-cancelled', 'event-submitted', 'event-published'], true))
        <div class="govuk-notification-banner govuk-notification-banner--success" data-module="govuk-notification-banner" role="alert" aria-labelledby="event-organiser-success-title">
            <div class="govuk-notification-banner__header">
                <h2 class="govuk-notification-banner__title" id="event-organiser-success-title">{{ __('govuk_alpha.states.success_title') }}</h2>
            </div>
            <div class="govuk-notification-banner__content">
                <p class="govuk-notification-banner__heading">{{ match ($status) {
                    'event-updated' => __('govuk_alpha.events.updated'),
                    'event-cancelled' => __('govuk_alpha.events.cancelled'),
                    'event-submitted' => __('govuk_alpha.events.publication_submitted_success'),
                    default => __('govuk_alpha.events.publication_published_success'),
                } }}</p>
            </div>
        </div>
    @elseif ($status === 'checkin-success')
        <div class="govuk-notification-banner govuk-notification-banner--success" data-module="govuk-notification-banner" role="alert" aria-labelledby="checkin-success-title">
            <div class="govuk-notification-banner__header">
                <h2 class="govuk-notification-banner__title" id="checkin-success-title">{{ __('govuk_alpha.states.success_title') }}</h2>
            </div>
            <div class="govuk-notification-banner__content">
                <p class="govuk-notification-banner__heading">{{ __('govuk_alpha.events.polish_events.checkin_success') }}</p>
            </div>
        </div>
    @elseif ($status === 'checkin-failed')
        <div class="govuk-error-summary" data-module="govuk-error-summary" tabindex="-1">
            <div role="alert">
                <h2 class="govuk-error-summary__title">{{ __('govuk_alpha.states.error_title') }}</h2>
                <div class="govuk-error-summary__body">
                    <p>{{ __('govuk_alpha.events.polish_events.checkin_failed') }}</p>
                </div>
            </div>
        </div>
    @elseif (in_array($status, ['waitlist-joined', 'waitlist-left', 'waitlist-offer-accepted', 'poll-voted'], true))
        @php
            $depthMessage = match ($status) {
                'waitlist-joined' => __('govuk_alpha.events.states.waitlist-joined'),
                'waitlist-left' => __('govuk_alpha.events.states.waitlist-left'),
                'waitlist-offer-accepted' => __('govuk_alpha.events.waitlist_offer_accepted'),
                default => __('govuk_alpha.events.states.poll-voted'),
            };
        @endphp
        <div class="govuk-notification-banner govuk-notification-banner--success" data-module="govuk-notification-banner" role="alert" aria-labelledby="event-depth-success-title">
            <div class="govuk-notification-banner__header">
                <h2 class="govuk-notification-banner__title" id="event-depth-success-title">{{ __('govuk_alpha.states.success_title') }}</h2>
            </div>
            <div class="govuk-notification-banner__content">
                <p class="govuk-notification-banner__heading">{{ $depthMessage }}</p>
            </div>
        </div>
    @elseif (in_array($status, ['rsvp-failed', 'rsvp-vetting-required', 'rsvp-policy-unavailable', 'event-update-failed', 'event-cancel-failed', 'event-publication-failed', 'waitlist-failed', 'waitlist-offer-accept-failed', 'waitlist-vetting-required', 'waitlist-policy-unavailable', 'poll-vote-failed'], true))
        @php
            $depthError = match ($status) {
                'rsvp-failed' => __('govuk_alpha.events.rsvp_failed'),
                'rsvp-vetting-required', 'waitlist-vetting-required' => __('safeguarding.errors.vetting_required_detail'),
                'rsvp-policy-unavailable', 'waitlist-policy-unavailable' => __('safeguarding.errors.policy_unavailable_detail'),
                'event-update-failed' => __('govuk_alpha.events.update_failed'),
                'event-cancel-failed' => __('govuk_alpha.events.cancel_failed'),
                'event-publication-failed' => __('govuk_alpha.events.publication_failed'),
                'waitlist-offer-accept-failed' => __('govuk_alpha.events.waitlist_offer_accept_failed'),
                'waitlist-failed' => __('govuk_alpha.events.states.waitlist-failed'),
                default => __('govuk_alpha.events.states.poll-vote-failed'),
            };
        @endphp
        <div class="govuk-error-summary" data-module="govuk-error-summary" tabindex="-1">
            <div role="alert">
                <h2 class="govuk-error-summary__title">{{ __('govuk_alpha.states.error_title') }}</h2>
                <div class="govuk-error-summary__body">
                    <p>{{ $depthError }}</p>
                </div>
            </div>
        </div>
    @endif

    {{-- Cancelled event warning — rendered ABOVE the grid so it spans full width --}}
    @if ($isCancelled)
        <div class="govuk-warning-text govuk-!-margin-bottom-6">
            <span class="govuk-warning-text__icon" aria-hidden="true">!</span>
            <strong class="govuk-warning-text__text">
                <span class="govuk-visually-hidden">{{ __('govuk_alpha.states.warning_prefix') }}</span>
                {{ __('govuk_alpha.events.polish_events.cancelled_banner_heading') }}
                @if (!empty($schedule['cancellation_reason']))
                    <br>
                    <span class="govuk-body govuk-!-margin-top-1">{{ __('govuk_alpha.events.polish_events.cancelled_reason_prefix') }} {{ $schedule['cancellation_reason'] }}</span>
                @endif
            </strong>
        </div>
    @endif

    @if ($isArchived)
        <div class="govuk-notification-banner" data-module="govuk-notification-banner" role="region" aria-labelledby="event-archived-title">
            <div class="govuk-notification-banner__header">
                <h2 class="govuk-notification-banner__title" id="event-archived-title">{{ __('govuk_alpha.events.archive_event') }}</h2>
            </div>
            <div class="govuk-notification-banner__content">
                <p class="govuk-notification-banner__heading">{{ __('govuk_alpha.events.archived_notice') }}</p>
            </div>
        </div>
    @endif

    <div
        class="govuk-grid-row"
        data-events-contract-version="{{ $event['contract_version'] ?? '' }}"
        data-event-timezone="{{ $timezone }}"
        data-event-engagement-state="{{ $engagementState }}"
        data-event-registration-state="{{ $registrationState }}"
        data-event-attendance-state="{{ $attendanceState }}"
        data-event-online-access-state="{{ $onlineAccess['reveal_state'] ?? '' }}">
        <div class="govuk-grid-column-two-thirds">
            <span class="govuk-caption-l">{{ __('govuk_alpha.events.detail_title') }}</span>
            <h1 class="govuk-heading-xl">{{ $event['title'] }}</h1>

            @if (!empty($eventOperations['people']) || !empty($eventOperations['attendance']) || !empty($eventOperations['broadcast']) || !empty($eventOperations['recurrence_definitions']) || $registrationState !== 'none' || !empty($event['permissions']['edit']) || ($isOwner ?? false))
                <nav class="govuk-button-group" aria-label="{{ __('govuk_alpha.events.operations_navigation') }}">
                    @if (!empty($eventOperations['people']) || $registrationState !== 'none' || ($isOwner ?? false))
                        <a class="govuk-button govuk-button--secondary" href="{{ route('govuk-alpha.events.registration.index', ['tenantSlug' => $tenantSlug, 'id' => $event['id']]) }}">{{ __('event_registration.title') }}</a>
                    @endif
                    @if (!empty($eventOperations['people']))
                        <a class="govuk-button govuk-button--secondary" href="{{ route('govuk-alpha.events.people', ['tenantSlug' => $tenantSlug, 'id' => $event['id']]) }}">{{ __('govuk_alpha.events.people_title') }}</a>
                    @endif
                    @if (!empty($eventOperations['attendance']))
                        <a class="govuk-button govuk-button--secondary" href="{{ route('govuk-alpha.events.check-in', ['tenantSlug' => $tenantSlug, 'id' => $event['id']]) }}">{{ __('govuk_alpha.events.check_in_title') }}</a>
                    @endif
                    @if (!empty($eventOperations['broadcast']))
                        <a class="govuk-button govuk-button--secondary" href="{{ route('govuk-alpha.events.communications.index', ['tenantSlug' => $tenantSlug, 'id' => $event['id']]) }}">{{ __('govuk_alpha.events.communications.title') }}</a>
                    @endif
                    @if (!empty($eventOperations['recurrence_definitions']))
                        <a class="govuk-button govuk-button--secondary" href="{{ route('govuk-alpha.events.recurrence-definitions.index', ['tenantSlug' => $tenantSlug, 'id' => $event['id']]) }}">{{ __('event_recurrence_blueprints.tab') }}</a>
                    @endif
                    @if ($isOwner ?? false)
                        <a class="govuk-button govuk-button--secondary" href="{{ route('govuk-alpha.events.analytics.show', ['tenantSlug' => $tenantSlug, 'id' => $event['id']]) }}">{{ __('govuk_alpha.events.analytics.link') }}</a>
                        <a class="govuk-button govuk-button--secondary" href="{{ route('govuk-alpha.events.templates.index', ['tenantSlug' => $tenantSlug]) }}">{{ __('event_templates.title') }}</a>
                    @endif
                    @if (!empty($event['permissions']['edit']))
                        <a class="govuk-button govuk-button--secondary" href="{{ route('govuk-alpha.events.lifecycle-history', ['tenantSlug' => $tenantSlug, 'id' => $event['id']]) }}">{{ __('event_lifecycle_history.link') }}</a>
                    @endif
                </nav>
            @endif

            {{-- Capacity tag — moved into two-thirds column, immediately after h1, before image --}}
            @if (!empty($event['is_full']))
                <p class="govuk-!-margin-bottom-4"><strong class="govuk-tag govuk-tag--red">{{ __('govuk_alpha.events.full') }}</strong></p>
            @elseif (array_key_exists('spots_left', $event) && $event['spots_left'] !== null)
                <p class="govuk-!-margin-bottom-4"><strong class="govuk-tag govuk-tag--green">{{ __('govuk_alpha.events.spots_left', ['count' => $event['spots_left']]) }}</strong></p>
            @endif

            @php
                // Treasury attendance reward — shown only when the tenant has
                // the feature on AND this event carries a positive amount.
                $alphaAttendanceReward = \App\Core\TenantContext::hasFeature('event_attendance_credits')
                    && !empty($event['attendance_credit_amount'])
                    && (float) $event['attendance_credit_amount'] > 0
                        ? round((float) $event['attendance_credit_amount'], 2)
                        : null;
            @endphp
            @if ($alphaAttendanceReward !== null)
                <p class="govuk-!-margin-bottom-4"><strong class="govuk-tag govuk-tag--green">{{ __('govuk_alpha.events.attendance_reward_tag', ['amount' => $alphaAttendanceReward]) }}</strong></p>
            @endif

            @php
                // Mirror EventsParity::eventsIsSeries — only recurring events get the
                // series-edit flow; a non-series event would just be redirected.
                $eventIsSeries = !empty($event['is_series'])
                    || !empty($event['is_recurring_template'])
                    || !empty($event['parent_event_id'])
                    || (!empty($seriesEvents) && count($seriesEvents) > 1);
            @endphp
            @if (!$isArchived && (!empty($event['permissions']['submit_for_review']) || !empty($event['permissions']['publish'])))
                @php
                    $publicationAction = !empty($event['permissions']['submit_for_review']) ? 'submit' : 'publish';
                @endphp
                <details class="govuk-details govuk-!-margin-bottom-4" data-module="govuk-details">
                    <summary class="govuk-details__summary">
                        <span class="govuk-details__summary-text">{{ $publicationAction === 'submit' ? __('govuk_alpha.events.submit_for_review') : __('govuk_alpha.events.publish_event') }}</span>
                    </summary>
                    <div class="govuk-details__text">
                        <p class="govuk-body">{{ $publicationAction === 'submit' ? __('govuk_alpha.events.publication_submit_confirm') : __('govuk_alpha.events.publication_publish_confirm') }}</p>
                        <form method="post" action="{{ route($publicationAction === 'submit' ? 'govuk-alpha.events.submit' : 'govuk-alpha.events.publish', ['tenantSlug' => $tenantSlug, 'id' => $event['id']]) }}">
                            @csrf
                            <button class="govuk-button govuk-!-margin-bottom-0" data-module="govuk-button">{{ $publicationAction === 'submit' ? __('govuk_alpha.events.submit_for_review') : __('govuk_alpha.events.publish_event') }}</button>
                        </form>
                    </div>
                </details>
            @endif
            @if (($isOwner ?? false) && !$isArchived)
                <div class="govuk-button-group govuk-!-margin-bottom-4">
                    <a class="govuk-button govuk-button--secondary govuk-!-margin-bottom-0" href="{{ route('govuk-alpha.events.edit', ['tenantSlug' => $tenantSlug, 'id' => $event['id']]) }}" role="button" draggable="false" data-module="govuk-button">{{ __('govuk_alpha.events.edit_event') }}</a>
                    @if ($eventIsSeries)
                        <a class="govuk-button govuk-button--secondary govuk-!-margin-bottom-0" href="{{ route('govuk-alpha.events.recurring.edit', ['tenantSlug' => $tenantSlug, 'id' => $event['id']]) }}" role="button" draggable="false" data-module="govuk-button">{{ __('govuk_alpha_events.nav.edit_series') }}</a>
                    @endif
                    <a class="govuk-button govuk-button--secondary govuk-!-margin-bottom-0" href="{{ route('govuk-alpha.events.polls', ['tenantSlug' => $tenantSlug, 'id' => $event['id']]) }}" role="button" draggable="false" data-module="govuk-button">{{ __('govuk_alpha_events.nav.manage_polls') }}</a>
                    <a class="govuk-button govuk-button--secondary govuk-!-margin-bottom-0" href="{{ route('govuk-alpha.events.templates.capture.preview', ['tenantSlug' => $tenantSlug, 'id' => $event['id']]) }}" role="button" draggable="false" data-module="govuk-button">{{ __('event_templates.capture_preview_title') }}</a>
                </div>
                @unless($isCancelled)
                    <details class="govuk-details govuk-!-margin-bottom-2" data-module="govuk-details">
                        <summary class="govuk-details__summary"><span class="govuk-details__summary-text">{{ __('govuk_alpha.events.cancel_event') }}</span></summary>
                        <div class="govuk-details__text">
                            <p class="govuk-body">{{ __('govuk_alpha.events.cancel_confirm') }}</p>
                            <form method="post" action="{{ route('govuk-alpha.events.cancel', ['tenantSlug' => $tenantSlug, 'id' => $event['id']]) }}">
                                @csrf
                                <input type="hidden" name="idempotency_key" value="{{ \Illuminate\Support\Str::uuid() }}">
                                <div class="govuk-form-group">
                                    <label class="govuk-label" for="cancel-reason">{{ __('govuk_alpha.events.cancel_reason_label') }}</label>
                                    <textarea class="govuk-textarea" id="cancel-reason" name="reason" rows="3" required></textarea>
                                </div>
                                <button class="govuk-button govuk-button--warning govuk-!-margin-bottom-0" data-module="govuk-button">{{ __('govuk_alpha.events.cancel_event_button') }}</button>
                            </form>
                        </div>
                    </details>
                @endunless
                <details class="govuk-details govuk-!-margin-bottom-4" data-module="govuk-details">
                    <summary class="govuk-details__summary"><span class="govuk-details__summary-text">{{ __('govuk_alpha.events.archive_event') }}</span></summary>
                    <div class="govuk-details__text">
                        <p class="govuk-body">{{ __('govuk_alpha.events.archive_confirm') }}</p>
                        <form method="post" action="{{ route('govuk-alpha.events.delete', ['tenantSlug' => $tenantSlug, 'id' => $event['id']]) }}">
                            @csrf
                            <input type="hidden" name="idempotency_key" value="{{ \Illuminate\Support\Str::uuid() }}">
                            <div class="govuk-form-group">
                                <label class="govuk-label" for="archive-reason">{{ __('govuk_alpha.events.archive_reason_label') }}</label>
                            <textarea class="govuk-textarea" id="archive-reason" name="reason" rows="2" required></textarea>
                            </div>
                            <button class="govuk-button govuk-button--warning govuk-!-margin-bottom-0" data-module="govuk-button">{{ __('govuk_alpha.events.archive_event_button') }}</button>
                        </form>
                    </div>
                </details>
            @endif

            @if ($primaryImage)
                <figure class="nexus-alpha-detail-hero">
                    <img src="{{ $primaryImage }}" alt="{{ __('govuk_alpha.events.image_alt', ['title' => $event['title']]) }}" width="640" height="360" decoding="async">
                </figure>
            @endif

            <h2 class="govuk-heading-l">{{ __('govuk_alpha.events.description_title') }}</h2>
            <div class="govuk-body">{!! nl2br(e((string) ($event['description'] ?? ''))) !!}</div>

    {{-- Summary, RSVP, polls, series and attendees stay inside the same two-thirds
         reading column as the title/description — the column closes before @endsection. --}}
    <h2 class="govuk-heading-l">{{ __('govuk_alpha.events.summary_title') }}</h2>
    <dl class="govuk-summary-list">
        @if ($start)
            <div class="govuk-summary-list__row">
                <dt class="govuk-summary-list__key">{{ __('govuk_alpha.events.starts') }}</dt>
                <dd class="govuk-summary-list__value">{{ $start }}@if($isAllDay) · {{ __('govuk_alpha.events.all_day') }}@endif</dd>
            </div>
        @endif
        @if ($end)
            <div class="govuk-summary-list__row">
                <dt class="govuk-summary-list__key">{{ __('govuk_alpha.events.ends') }}</dt>
                <dd class="govuk-summary-list__value">{{ $end }}</dd>
            </div>
        @endif
        <div class="govuk-summary-list__row">
            <dt class="govuk-summary-list__key">{{ __('govuk_alpha.events.location') }}</dt>
            <dd class="govuk-summary-list__value">
                {{ $locationFacts['label'] ?? __('govuk_alpha.events.online') }}
                @php
                    $eventHasCoords = isset($locationFacts['latitude'], $locationFacts['longitude'])
                        && $locationFacts['latitude'] !== null && $locationFacts['longitude'] !== null
                        && ($locationFacts['mode'] ?? 'in_person') !== 'online';
                @endphp
                @if ($eventHasCoords && \App\Core\TenantContext::hasFeature('maps'))
                    <br><a class="govuk-link" href="{{ route('govuk-alpha.events.map', ['tenantSlug' => $tenantSlug, 'id' => $event['id']]) }}">{{ __('govuk_alpha_events.nav.view_location') }}</a>
                @endif
            </dd>
        </div>
        @if (($onlineAccess['reveal_state'] ?? '') === 'available' && !empty($onlineAccess['join_url']) && \Illuminate\Support\Str::startsWith((string) $onlineAccess['join_url'], ['http://', 'https://']))
            <div class="govuk-summary-list__row">
                <dt class="govuk-summary-list__key">{{ __('govuk_alpha.events.online_link_label') }}</dt>
                <dd class="govuk-summary-list__value">
                    <a class="govuk-link" href="{{ $onlineAccess['join_url'] }}" rel="noopener noreferrer">{{ __('govuk_alpha.events.online_link_text') }}</a>
                </dd>
            </div>
        @endif
        @php $videoUrl = ($onlineAccess['reveal_state'] ?? '') === 'available' ? ($onlineAccess['video_url'] ?? null) : null; @endphp
        @if ($videoUrl && \Illuminate\Support\Str::startsWith((string) $videoUrl, ['http://', 'https://']))
            <div class="govuk-summary-list__row">
                <dt class="govuk-summary-list__key">{{ __('govuk_alpha.events.polish_events.video_url_summary_label') }}</dt>
                <dd class="govuk-summary-list__value">
                    <a class="govuk-link" href="{{ $videoUrl }}" rel="noopener noreferrer">{{ __('govuk_alpha.events.polish_events.video_url_link_text') }}</a>
                </dd>
            </div>
        @endif
        @if ($organiserName !== '')
            <div class="govuk-summary-list__row">
                <dt class="govuk-summary-list__key">{{ __('govuk_alpha.events.organiser') }}</dt>
                <dd class="govuk-summary-list__value">{{ $organiserName }}</dd>
            </div>
        @endif
        @if ($categoryName)
            <div class="govuk-summary-list__row">
                <dt class="govuk-summary-list__key">{{ __('govuk_alpha.events.category') }}</dt>
                <dd class="govuk-summary-list__value">{{ $categoryName }}</dd>
            </div>
        @endif
        <div class="govuk-summary-list__row">
            <dt class="govuk-summary-list__key">{{ __('govuk_alpha.events.attendees_label') }}</dt>
            <dd class="govuk-summary-list__value">{{ trans_choice('govuk_alpha.events.attendees', (int) ($metrics['confirmed_count'] ?? 0), ['count' => (int) ($metrics['confirmed_count'] ?? 0)]) }}</dd>
        </div>
        <div class="govuk-summary-list__row">
            <dt class="govuk-summary-list__key">{{ __('govuk_alpha.events.interested_label') }}</dt>
            <dd class="govuk-summary-list__value">{{ trans_choice('govuk_alpha.events.interested', (int) ($metrics['interested_count'] ?? 0), ['count' => (int) ($metrics['interested_count'] ?? 0)]) }}</dd>
        </div>
    </dl>

    @if (($venueAccessibility['provided'] ?? false) === true && ($locationFacts['mode'] ?? 'in_person') !== 'online')
        @php
            $venueAccessFeatures = [
                'step_free_access',
                'accessible_toilet',
                'hearing_loop',
                'quiet_space',
                'seating_available',
                'accessible_parking',
            ];
            $venueAccessDetails = [
                'parking_details',
                'transit_details',
                'assistance_contact',
                'notes',
            ];
        @endphp
        <section class="govuk-!-margin-top-7" aria-labelledby="venue-accessibility-heading">
            <h2 class="govuk-heading-l" id="venue-accessibility-heading">{{ __('event_accessibility.detail.title') }}</h2>
            <p class="govuk-body">{{ __('event_accessibility.detail.intro') }}</p>
            <dl class="govuk-summary-list">
                @foreach ($venueAccessFeatures as $key)
                    @php
                        $value = $venueAccessibility[$key] ?? null;
                        $accessStatus = $value === true ? 'yes' : ($value === false ? 'no' : 'unknown');
                    @endphp
                    <div class="govuk-summary-list__row">
                        <dt class="govuk-summary-list__key">{{ __('event_accessibility.features.' . $key) }}</dt>
                        <dd class="govuk-summary-list__value">{{ __('event_accessibility.status.' . $accessStatus) }}</dd>
                    </div>
                @endforeach
                @foreach ($venueAccessDetails as $key)
                    @if (!empty($venueAccessibility[$key]))
                        <div class="govuk-summary-list__row">
                            <dt class="govuk-summary-list__key">{{ __('event_accessibility.detail.' . $key) }}</dt>
                            <dd class="govuk-summary-list__value">{{ $venueAccessibility[$key] }}</dd>
                        </div>
                    @endif
                @endforeach
            </dl>
        </section>
    @endif

    {{-- Share link — zero-JS mailto: fallback. Shown for all authenticated visitors on non-cancelled events. --}}
    @if (!$requiresAuth)
        @php
            $shareUrl = route('govuk-alpha.events.show', ['tenantSlug' => $tenantSlug, 'id' => $event['id']]);
            $shareSubject = rawurlencode($event['title'] ?? '');
            $shareBody = rawurlencode($shareUrl);
        @endphp
        <p class="govuk-body govuk-!-margin-top-4">
            <a class="govuk-link" href="mailto:?subject={{ $shareSubject }}&body={{ $shareBody }}">{{ __('govuk_alpha.events.polish_events.share_email_label') }}</a>
            <span aria-hidden="true"> &middot; </span>
            <a class="govuk-link" href="{{ route('govuk-alpha.events.translate', ['tenantSlug' => $tenantSlug, 'id' => $event['id']]) }}">{{ __('govuk_alpha_events.nav.translate_description') }}</a>
        </p>
    @endif

    @if ($requiresAuth)
        <div class="govuk-notification-banner" data-module="govuk-notification-banner" role="region" aria-labelledby="events-auth-title">
            <div class="govuk-notification-banner__header">
                <h2 class="govuk-notification-banner__title" id="events-auth-title">{{ __('govuk_alpha.states.auth_required') }}</h2>
            </div>
            <div class="govuk-notification-banner__content">
                <p class="govuk-body">{{ __('govuk_alpha.events.auth_required_detail', ['community' => $tenant['name'] ?? $tenantSlug]) }}</p>
                <div class="govuk-button-group">
                    <a class="govuk-button" href="{{ route('govuk-alpha.login', ['tenantSlug' => $tenantSlug]) }}" role="button" draggable="false" data-module="govuk-button">{{ __('govuk_alpha.nav.login') }}</a>
                    <a class="govuk-link" href="{{ route('govuk-alpha.register', ['tenantSlug' => $tenantSlug]) }}">{{ __('govuk_alpha.nav.register') }}</a>
                </div>
            </div>
        </div>
    @else
        @php
            $hasActiveWaitlistOffer = $registrationState === 'offered';
            $onWaitlist = in_array($registrationState, ['waitlisted', 'offered'], true);
            $registrationCapabilities = is_array($relationship['registration'] ?? null)
                ? $relationship['registration']
                : [];
            $canRegister = (bool) ($registrationCapabilities['can_register'] ?? false);
            $canWithdraw = (bool) ($registrationCapabilities['can_withdraw'] ?? false);
            $canJoinWaitlist = (bool) ($registrationCapabilities['can_join_waitlist'] ?? false);
            $canLeaveWaitlist = (bool) ($registrationCapabilities['can_leave_waitlist'] ?? false);
            $canChangeEngagement = (bool) ($relationship['engagement']['can_change'] ?? false);
            $rsvpOptions = [];
            if ($canRegister) {
                $rsvpOptions[] = 'going';
            }
            if ($canChangeEngagement) {
                $rsvpOptions[] = 'interested';
            }
            if ($canWithdraw || $canChangeEngagement) {
                $rsvpOptions[] = 'not_going';
            }
            $requiresRsvpCancellationConfirmation = in_array($currentRsvp, ['going', 'interested'], true)
                && in_array('not_going', $rsvpOptions, true);
            if ($requiresRsvpCancellationConfirmation) {
                $rsvpOptions = array_values(array_diff($rsvpOptions, ['not_going']));
            }
        @endphp

        @if ($onWaitlist || $canJoinWaitlist)
            <section class="govuk-!-margin-top-7" aria-labelledby="waitlist-heading">
                <h2 class="govuk-heading-m" id="waitlist-heading">{{ $hasActiveWaitlistOffer ? __('govuk_alpha.events.waitlist_offer_title') : __('govuk_alpha.events.waitlist_heading') }}</h2>
                @if ($hasActiveWaitlistOffer)
                    <div class="govuk-inset-text">
                        <p class="govuk-body govuk-!-margin-bottom-0">{{ __('govuk_alpha.events.waitlist_offer_description') }}</p>
                    </div>
                    <div class="govuk-button-group">
                        <form method="post" action="{{ route('govuk-alpha.events.waitlist.accept', ['tenantSlug' => $tenantSlug, 'id' => $event['id']]) }}">
                            @csrf
                            <input type="hidden" name="idempotency_key" value="{{ (string) \Illuminate\Support\Str::uuid() }}">
                            <button class="govuk-button govuk-!-margin-bottom-0" data-module="govuk-button">{{ __('govuk_alpha.events.waitlist_offer_accept') }}</button>
                        </form>
                        @if ($canLeaveWaitlist)
                            <details class="govuk-details govuk-!-margin-bottom-0" data-module="govuk-details">
                                <summary class="govuk-details__summary"><span class="govuk-details__summary-text">{{ __('govuk_alpha.events.waitlist_offer_decline') }}</span></summary>
                                <div class="govuk-details__text">
                                    <p class="govuk-body">{{ __('govuk_alpha.events.waitlist_offer_description') }}</p>
                                    <form method="post" action="{{ route('govuk-alpha.events.waitlist.leave', ['tenantSlug' => $tenantSlug, 'id' => $event['id']]) }}">
                                        @csrf
                                        <button class="govuk-button govuk-button--warning govuk-!-margin-bottom-0" data-module="govuk-button">{{ __('govuk_alpha.events.waitlist_offer_decline') }}</button>
                                    </form>
                                </div>
                            </details>
                        @endif
                    </div>
                @elseif ($onWaitlist)
                    <div class="govuk-inset-text">
                        <p class="govuk-body govuk-!-margin-bottom-1">{{ __('govuk_alpha.events.waitlist_on_list_note') }}</p>
                        @if (($relationship['registration']['waitlist_position'] ?? null) !== null)
                            <p class="govuk-body govuk-!-margin-bottom-0 govuk-!-font-weight-bold">{{ __('govuk_alpha.events.waitlist_position', ['position' => $relationship['registration']['waitlist_position']]) }}</p>
                        @endif
                    </div>
                    @if ($canLeaveWaitlist)
                        <details class="govuk-details govuk-!-margin-bottom-0" data-module="govuk-details">
                            <summary class="govuk-details__summary"><span class="govuk-details__summary-text">{{ __('govuk_alpha.events.waitlist_leave') }}</span></summary>
                            <div class="govuk-details__text">
                                <p class="govuk-body">{{ __('govuk_alpha.events.waitlist_on_list_note') }}</p>
                                <form method="post" action="{{ route('govuk-alpha.events.waitlist.leave', ['tenantSlug' => $tenantSlug, 'id' => $event['id']]) }}">
                                    @csrf
                                    <button class="govuk-button govuk-button--warning govuk-!-margin-bottom-0" data-module="govuk-button">{{ __('govuk_alpha.events.waitlist_leave') }}</button>
                                </form>
                            </div>
                        </details>
                    @endif
                @elseif ($canJoinWaitlist)
                    <p class="govuk-body">{{ __('govuk_alpha.events.waitlist_full_note') }}</p>
                    <form method="post" action="{{ route('govuk-alpha.events.waitlist.join', ['tenantSlug' => $tenantSlug, 'id' => $event['id']]) }}">
                        @csrf
                        <button class="govuk-button govuk-!-margin-bottom-0" data-module="govuk-button">{{ __('govuk_alpha.events.waitlist_join') }}</button>
                    </form>
                @endif
            </section>
        @endif

        @if (!$hasActiveWaitlistOffer && !empty($rsvpOptions))
        <form method="post" action="{{ route('govuk-alpha.events.rsvp.store', ['tenantSlug' => $tenantSlug, 'id' => $event['id']]) }}" class="govuk-!-margin-top-7">
            @csrf
            <fieldset class="govuk-fieldset" aria-describedby="rsvp-hint">
                <legend class="govuk-fieldset__legend govuk-fieldset__legend--m">
                    <h2 class="govuk-fieldset__heading">{{ __('govuk_alpha.events.rsvp_title') }}</h2>
                </legend>
                <div id="rsvp-hint" class="govuk-hint">{{ __('govuk_alpha.events.rsvp_hint') }}</div>
                <div class="govuk-radios" data-module="govuk-radios">
                    @foreach ($rsvpOptions as $rsvpStatus)
                        <div class="govuk-radios__item">
                            <input class="govuk-radios__input" id="status-{{ $rsvpStatus }}" name="status" type="radio" value="{{ $rsvpStatus }}" required @checked(($currentRsvp ?? null) === $rsvpStatus)>
                            <label class="govuk-label govuk-radios__label" for="status-{{ $rsvpStatus }}">{{ __('govuk_alpha.events.rsvp_status.' . $rsvpStatus) }}</label>
                        </div>
                    @endforeach
                </div>
            </fieldset>
            <button class="govuk-button govuk-!-margin-top-4" data-module="govuk-button">{{ __('govuk_alpha.actions.rsvp') }}</button>
        </form>
        @endif

        @if ($requiresRsvpCancellationConfirmation)
            <details class="govuk-details govuk-!-margin-top-7" data-module="govuk-details">
                <summary class="govuk-details__summary"><span class="govuk-details__summary-text">{{ __('govuk_alpha.events.rsvp_status.not_going') }}</span></summary>
                <div class="govuk-details__text">
                    <p class="govuk-body">{{ __('govuk_alpha.events.rsvp_hint') }}</p>
                    <form method="post" action="{{ route('govuk-alpha.events.rsvp.store', ['tenantSlug' => $tenantSlug, 'id' => $event['id']]) }}">
                        @csrf
                        <input type="hidden" name="status" value="not_going">
                        <button class="govuk-button govuk-button--warning govuk-!-margin-bottom-0" data-module="govuk-button">{{ __('govuk_alpha.actions.rsvp') }}</button>
                    </form>
                </div>
            </details>
        @endif

        {{-- ===== Event polls ===== --}}
        @if (!empty($polls))
            @php $pollDate = fn ($v): ?string => $v ? \Illuminate\Support\Carbon::parse($v)->translatedFormat('j F Y') : null; @endphp
            <section class="govuk-!-margin-top-8" aria-labelledby="event-polls-heading">
                <h2 class="govuk-heading-l" id="event-polls-heading">{{ __('govuk_alpha.events.polls_heading') }}</h2>
                <p class="govuk-body">{{ __('govuk_alpha.events.polls_intro') }}</p>

                @foreach ($polls as $poll)
                    @php
                        $pollId = (int) ($poll['id'] ?? 0);
                        $question = trim((string) ($poll['question'] ?? '')) ?: __('govuk_alpha.events.polls_heading');
                        $pollOpen = ($poll['status'] ?? 'closed') === 'open';
                        $hasVoted = (bool) ($poll['has_voted'] ?? false);
                        $votedOptionId = $poll['voted_option_id'] ?? null;
                        $options = is_array($poll['options'] ?? null) ? $poll['options'] : [];
                        $resultsVisible = (bool) ($poll['results_visible'] ?? false);
                        $totalVotes = (int) ($poll['total_votes'] ?? 0);
                        $closesOn = $pollDate($poll['expires_at'] ?? null);
                        $maxVotes = 0;
                        foreach ($options as $o) { $maxVotes = max($maxVotes, (int) ($o['vote_count'] ?? 0)); }
                    @endphp
                    <article class="nexus-alpha-card govuk-!-margin-bottom-6" id="poll-{{ $pollId }}">
                        <div class="nexus-alpha-module-row">
                            <h3 class="govuk-heading-m govuk-!-margin-bottom-1">{{ $question }}</h3>
                            @if ($pollOpen)
                                <strong class="govuk-tag govuk-tag--green">{{ __('govuk_alpha.events.poll_open_tag') }}</strong>
                            @else
                                <strong class="govuk-tag govuk-tag--grey">{{ __('govuk_alpha.events.poll_closed_tag') }}</strong>
                            @endif
                        </div>
                        @if (!empty($poll['description']))
                            <p class="govuk-body">{{ $poll['description'] }}</p>
                        @endif

                        @if (empty($options))
                            <div class="govuk-inset-text"><p class="govuk-body">{{ __('govuk_alpha.events.poll_no_options') }}</p></div>
                        @elseif ($pollOpen && !$hasVoted)
                            {{-- Open + not voted: show the vote form. Totals stay hidden (ballot secrecy). --}}
                            <form method="post" action="{{ route('govuk-alpha.events.polls.vote', ['tenantSlug' => $tenantSlug, 'id' => $event['id'], 'pollId' => $pollId]) }}">
                                @csrf
                                <fieldset class="govuk-fieldset" aria-describedby="event-poll-{{ $pollId }}-hint">
                                    <legend class="govuk-fieldset__legend govuk-fieldset__legend--s">{{ __('govuk_alpha.events.poll_choose_label') }}</legend>
                                    <div id="event-poll-{{ $pollId }}-hint" class="govuk-hint">{{ __('govuk_alpha.events.poll_vote_once_hint') }}</div>
                                    <div class="govuk-radios govuk-radios--small" data-module="govuk-radios">
                                        @foreach ($options as $opt)
                                            <div class="govuk-radios__item">
                                                <input class="govuk-radios__input" id="event-poll-{{ $pollId }}-opt-{{ $opt['id'] }}" name="option_id" type="radio" value="{{ $opt['id'] }}">
                                                <label class="govuk-label govuk-radios__label" for="event-poll-{{ $pollId }}-opt-{{ $opt['id'] }}">{{ $opt['text'] ?? ($opt['label'] ?? '') }}</label>
                                            </div>
                                        @endforeach
                                    </div>
                                </fieldset>
                                <button class="govuk-button govuk-!-margin-top-2 govuk-!-margin-bottom-0" data-module="govuk-button">{{ __('govuk_alpha.events.poll_vote_button') }}</button>
                            </form>
                        @elseif ($resultsVisible)
                            {{-- Closed (or creator): show results with accessible progress bars. --}}
                            <p class="govuk-body-s nexus-alpha-meta">{{ trans_choice('govuk_alpha.events.poll_votes_count', $totalVotes, ['count' => $totalVotes]) }}</p>
                            @foreach ($options as $opt)
                                @php
                                    $pct = (float) ($opt['percentage'] ?? 0);
                                    $pctRounded = max(0, min(100, (int) round($pct)));
                                    $cnt = (int) ($opt['vote_count'] ?? 0);
                                    $isMine = $votedOptionId !== null && (int) ($opt['id'] ?? 0) === (int) $votedOptionId;
                                    $isLeading = $totalVotes > 0 && $cnt === $maxVotes;
                                    $optLabel = (string) ($opt['text'] ?? ($opt['label'] ?? ''));
                                @endphp
                                <div class="govuk-!-margin-bottom-3">
                                    <p class="govuk-body govuk-!-margin-bottom-1">
                                        {{ $optLabel }}
                                        @if ($isLeading)<strong class="govuk-tag govuk-tag--green">{{ __('govuk_alpha.events.poll_leading') }}</strong>@endif
                                        @if ($isMine)<strong class="govuk-tag govuk-tag--blue">{{ __('govuk_alpha.events.poll_your_choice') }}</strong>@endif
                                    </p>
                                    <progress max="100" value="{{ $pct }}" aria-label="{{ $optLabel }}: {{ $pctRounded }}%">{{ $pctRounded }}%</progress>
                                    <span class="govuk-body-s">{{ $pctRounded }}% — {{ trans_choice('govuk_alpha.events.poll_per_option_votes', $cnt, ['count' => $cnt]) }}</span>
                                </div>
                            @endforeach
                        @else
                            {{-- Open + already voted: hide running totals until close. --}}
                            <div class="govuk-inset-text">{{ __('govuk_alpha.events.poll_results_pending_note') }}</div>
                            <ul class="govuk-list">
                                @foreach ($options as $opt)
                                    @php $isMine = $votedOptionId !== null && (int) ($opt['id'] ?? 0) === (int) $votedOptionId; @endphp
                                    <li>
                                        {{ $opt['text'] ?? ($opt['label'] ?? '') }}
                                        @if ($isMine)<strong class="govuk-tag govuk-tag--blue">{{ __('govuk_alpha.events.poll_your_choice') }}</strong>@endif
                                    </li>
                                @endforeach
                            </ul>
                        @endif
                    </article>
                @endforeach
            </section>
        @endif
    @endif

    {{-- ===== Recurring series navigation ===== --}}
    @if (!empty($seriesEvents) && count($seriesEvents) > 1)
        @php $seriesDate = fn ($v): ?string => $v ? \Illuminate\Support\Carbon::parse($v)->translatedFormat('j F Y, g:ia') : null; @endphp
        <details class="govuk-details govuk-!-margin-top-8" data-module="govuk-details">
            <summary class="govuk-details__summary"><span class="govuk-details__summary-text">{{ __('govuk_alpha.events.series_heading') }}</span></summary>
            <div class="govuk-details__text">
                <p class="govuk-body">{{ __('govuk_alpha.events.series_intro') }}</p>
                <ul class="govuk-list">
                    @foreach ($seriesEvents as $sibling)
                        @php
                            $siblingId = (int) ($sibling['id'] ?? 0);
                            $siblingTitle = trim((string) ($sibling['title'] ?? '')) ?: __('govuk_alpha.events.detail_title');
                            $siblingWhen = $seriesDate($sibling['start_time'] ?? null);
                            $isCurrent = $siblingId === (int) ($event['id'] ?? 0);
                        @endphp
                        <li>
                            @if ($isCurrent)
                                <span class="govuk-!-font-weight-bold">{{ $siblingTitle }}</span>
                                <strong class="govuk-tag govuk-tag--blue">{{ __('govuk_alpha.events.series_this_event') }}</strong>
                                @if ($siblingWhen)<span class="nexus-alpha-meta govuk-body-s"> — {{ $siblingWhen }}</span>@endif
                            @else
                                <a class="govuk-link" href="{{ route('govuk-alpha.events.show', ['tenantSlug' => $tenantSlug, 'id' => $siblingId]) }}">{{ $siblingTitle }}</a>
                                @if ($siblingWhen)<span class="nexus-alpha-meta govuk-body-s"> — {{ $siblingWhen }}</span>@endif
                            @endif
                        </li>
                    @endforeach
                </ul>
            </div>
        </details>
    @endif

    {{-- ===== Attendee list (govuk-list, no custom class on <li>) ===== --}}
    @if (($attendeesLoadFailed ?? false) || !empty($attendees))
        <h2 class="govuk-heading-l govuk-!-margin-top-8">{{ __('govuk_alpha.events.attendees_title') }}</h2>

        {{-- Roster failures remain distinct from a genuinely empty roster. --}}
        @if ($attendeesLoadFailed ?? false)
            <div class="govuk-error-summary" data-module="govuk-error-summary" role="alert" aria-labelledby="attendees-error-title">
                <h3 class="govuk-error-summary__title" id="attendees-error-title">{{ __('govuk_alpha.states.error_title') }}</h3>
                <div class="govuk-error-summary__body">
                    <ul class="govuk-list govuk-error-summary__list">
                        <li>
                            <a href="{{ route('govuk-alpha.events.show', ['tenantSlug' => $tenantSlug, 'id' => $event['id']]) }}">
                                {{ __('govuk_alpha.events.attendees_title') }}
                            </a>
                        </li>
                    </ul>
                </div>
            </div>
        @endif

        @if (!empty($attendees))
            <ul class="govuk-list">
                @foreach ($attendees as $attendee)
                    @php
                        $attendeeName = trim((string) ($attendee['member']['display_name'] ?? '')) ?: __('govuk_alpha.members.unknown_member');
                        $attendeeRegistration = (string) ($attendee['registration']['state'] ?? 'none');
                        $attendeeEngagement = (string) ($attendee['engagement']['state'] ?? 'none');
                        $rsvpDisplay = $attendeeRegistration === 'confirmed' ? 'going' : ($attendeeEngagement === 'interested' ? 'interested' : 'not_going');
                    @endphp
                    <li>
                        @if (!empty($attendee['member']['avatar_url']))
                            <img class="nexus-alpha-avatar" src="{{ $attendee['member']['avatar_url'] }}" alt="" loading="lazy" decoding="async" width="48" height="48">
                        @else
                            <span class="nexus-alpha-avatar nexus-alpha-avatar--placeholder" aria-hidden="true">{{ mb_strtoupper(mb_substr($attendeeName, 0, 1)) }}</span>
                        @endif
                        <span class="govuk-body govuk-!-margin-bottom-0 govuk-!-font-weight-bold">{{ $attendeeName }}</span>
                        <strong class="govuk-tag {{ $rsvpDisplay === 'going' ? 'govuk-tag--green' : 'govuk-tag--grey' }}">{{ __('govuk_alpha.events.rsvp_status.' . $rsvpDisplay) }}</strong>
                    </li>
                @endforeach
            </ul>
        @endif

        @if (!empty($attendeesMeta['has_more']) && !empty($attendeesMeta['cursor']))
            @php
                $attendeesNextQuery = request()->query();
                $attendeesNextQuery['attendees_cursor'] = $attendeesMeta['cursor'];
            @endphp
            <p class="govuk-body govuk-!-margin-top-4">
                <a class="govuk-link" rel="next" href="{{ route('govuk-alpha.events.show', array_merge([
                    'tenantSlug' => $tenantSlug,
                    'id' => $event['id'],
                ], $attendeesNextQuery)) }}">
                    {{ __('govuk_alpha.actions.load_more') }}
                </a>
            </p>
        @endif
    @endif
        </div>
    </div>
@endsection
