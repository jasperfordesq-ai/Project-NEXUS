{{-- Copyright (c) 2024-2026 Jasper Ford --}}
{{-- SPDX-License-Identifier: AGPL-3.0-or-later --}}
{{-- Author: Jasper Ford --}}
{{-- See NOTICE file for attribution and acknowledgements. --}}
@extends('accessible-frontend::layout')

@section('content')
    @php
        $timezone = (string) ($agenda['timezone'] ?? 'UTC');
        $canManage = (bool) ($agenda['permissions']['manage'] ?? false);
        $sessions = is_array($agenda['sessions'] ?? null) ? $agenda['sessions'] : [];
        $scheduledSessions = array_values(array_filter($sessions, static fn (array $session): bool => ($session['status'] ?? null) === 'scheduled'));
        $cancelledSessions = array_values(array_filter($sessions, static fn (array $session): bool => ($session['status'] ?? null) === 'cancelled'));
        $dateTime = static fn ($value): string => $value
            ? \Illuminate\Support\Carbon::parse($value)->setTimezone($timezone)->translatedFormat('j F Y, g:ia T')
            : '';
        $localInput = static fn ($value): string => $value
            ? \Illuminate\Support\Carbon::parse($value)->setTimezone($timezone)->format('Y-m-d\TH:i')
            : '';
        $defaultSessionEnd = null;
        if (!empty($eventStart)) {
            $oneHourAfterStart = \Illuminate\Support\Carbon::parse($eventStart)->addHour();
            $eventEndDate = !empty($eventEnd) ? \Illuminate\Support\Carbon::parse($eventEnd) : null;
            $defaultSessionEnd = $eventEndDate !== null && $eventEndDate->lt($oneHourAfterStart)
                ? $eventEndDate
                : $oneHourAfterStart;
        }
        $successMessages = [
            'agenda-created' => __('govuk_alpha.events.agenda.created'),
            'agenda-updated' => __('govuk_alpha.events.agenda.updated'),
            'agenda-cancelled' => __('govuk_alpha.events.agenda.cancelled_success'),
            'agenda-reordered' => __('govuk_alpha.events.agenda.reordered'),
            'agenda-session-registered' => __('event_agenda.registered_success'),
            'agenda-session-withdrawn' => __('event_agenda.withdrawn_success'),
        ];
    @endphp

    <a class="govuk-back-link" href="{{ route('govuk-alpha.events.show', ['tenantSlug' => $tenantSlug, 'id' => $eventId]) }}">{{ __('govuk_alpha.events.agenda.back_to_event') }}</a>

    @if ($errors->has('agenda'))
        <div class="govuk-error-summary" data-module="govuk-error-summary" tabindex="-1">
            <div role="alert">
                <h2 class="govuk-error-summary__title">{{ __('govuk_alpha.states.error_title') }}</h2>
                <div class="govuk-error-summary__body"><p>{{ $errors->first('agenda') }}</p></div>
            </div>
        </div>
    @elseif (isset($successMessages[$status]))
        <div class="govuk-notification-banner govuk-notification-banner--success" data-module="govuk-notification-banner" role="alert">
            <div class="govuk-notification-banner__header"><h2 class="govuk-notification-banner__title">{{ __('govuk_alpha.states.success_title') }}</h2></div>
            <div class="govuk-notification-banner__content"><p class="govuk-notification-banner__heading">{{ $successMessages[$status] }}</p></div>
        </div>
    @endif

    <span class="govuk-caption-l">{{ $eventTitle }}</span>
    <h1 class="govuk-heading-xl">{{ __('govuk_alpha.events.agenda.title') }}</h1>
    <p class="govuk-body-l">{{ $canManage ? __('govuk_alpha.events.agenda.manager_intro') : __('govuk_alpha.events.agenda.viewer_intro') }}</p>

    {{-- Sessions keep their own 'scheduled' status after the event is
         cancelled (the agenda is preserved as a record), so without this the
         whole running order reads as though it is still happening. --}}
    @if (($agenda['event_status']['is_cancelled'] ?? false) === true)
        <div class="govuk-notification-banner" role="region"
             aria-labelledby="govuk-notification-banner-title-agenda"
             data-module="govuk-notification-banner">
            <div class="govuk-notification-banner__header">
                <h2 class="govuk-notification-banner__title" id="govuk-notification-banner-title-agenda">
                    {{ __('govuk_alpha.events.agenda.cancelled_heading') }}
                </h2>
            </div>
            <div class="govuk-notification-banner__content">
                <p class="govuk-notification-banner__heading">
                    {{ __('govuk_alpha.events.agenda.cancelled_notice') }}
                </p>
            </div>
        </div>
    @endif

    @if ($canManage)
        <details class="govuk-details" data-module="govuk-details" @if(old('action') === 'create') open @endif>
            <summary class="govuk-details__summary"><span class="govuk-details__summary-text">{{ __('govuk_alpha.events.agenda.add_session') }}</span></summary>
            <div class="govuk-details__text">
                <form method="post" action="{{ route('govuk-alpha.events.agenda.update', ['tenantSlug' => $tenantSlug, 'id' => $eventId]) }}">
                    @csrf
                    <input type="hidden" name="action" value="create">
                    <input type="hidden" name="idempotency_key" value="{{ \Illuminate\Support\Str::uuid() }}">
                    @include('accessible-frontend::partials.event-agenda-fields', [
                        'formKey' => 'agenda-create',
                        'values' => [
                            'type' => 'session',
                            'visibility' => 'public',
                            'start_at_local' => $localInput($eventStart ?? null),
                            'end_at_local' => $localInput($defaultSessionEnd),
                        ],
                        'speakerRows' => [],
                        'resourceRows' => [],
                        'useOld' => old('action') === 'create',
                    ])
                    <button class="govuk-button" data-module="govuk-button">{{ __('govuk_alpha.events.agenda.create_session') }}</button>
                </form>
            </div>
        </details>
    @endif

    <h2 class="govuk-heading-l">{{ __('govuk_alpha.events.agenda.running_order') }}</h2>
    @if (empty($scheduledSessions))
        <p class="govuk-body">{{ $canManage ? __('govuk_alpha.events.agenda.empty_manager') : __('govuk_alpha.events.agenda.empty_viewer') }}</p>
    @else
        <ol class="govuk-list govuk-list--number">
            @foreach ($scheduledSessions as $index => $session)
                @php
                    $sessionId = (int) ($session['id'] ?? 0);
                    $sessionKey = 'agenda-session-' . $sessionId;
                    $useOld = old('action') === 'update' && (int) old('session_id') === $sessionId;
                    $capacity = is_array($session['capacity'] ?? null) ? $session['capacity'] : [];
                    $registration = is_array($session['registration'] ?? null) ? $session['registration'] : [];
                @endphp
                <li class="govuk-!-margin-bottom-6">
                    <h3 class="govuk-heading-m govuk-!-margin-bottom-2">{{ $session['title'] }}</h3>
                    <p class="govuk-body-s govuk-!-margin-bottom-2">
                        <strong class="govuk-tag">{{ __('govuk_alpha.events.agenda.types.' . $session['type']) }}</strong>
                        <strong class="govuk-tag govuk-tag--grey">{{ __('govuk_alpha.events.agenda.visibilities.' . $session['visibility']) }}</strong>
                    </p>
                    <dl class="govuk-summary-list govuk-summary-list--no-border">
                        <div class="govuk-summary-list__row">
                            <dt class="govuk-summary-list__key">{{ __('govuk_alpha.events.agenda.when') }}</dt>
                            <dd class="govuk-summary-list__value">{{ $dateTime($session['start_at'] ?? null) }} – {{ $dateTime($session['end_at'] ?? null) }}</dd>
                        </div>
                        @if (!empty($session['track']))
                            <div class="govuk-summary-list__row"><dt class="govuk-summary-list__key">{{ __('govuk_alpha.events.agenda.fields.track') }}</dt><dd class="govuk-summary-list__value">{{ $session['track'] }}</dd></div>
                        @endif
                        @if (!empty($session['room']))
                            <div class="govuk-summary-list__row"><dt class="govuk-summary-list__key">{{ __('govuk_alpha.events.agenda.fields.room') }}</dt><dd class="govuk-summary-list__value">{{ $session['room'] }}</dd></div>
                        @endif
                        <div class="govuk-summary-list__row">
                            <dt class="govuk-summary-list__key">{{ __('event_agenda.capacity_label') }}</dt>
                            <dd class="govuk-summary-list__value">
                                @if (($capacity['limit'] ?? null) === null)
                                    {{ __('event_agenda.capacity_unlimited', ['registered' => (int) ($capacity['registered'] ?? 0)]) }}
                                @else
                                    {{ __('event_agenda.capacity_limited', ['registered' => (int) ($capacity['registered'] ?? 0), 'limit' => (int) $capacity['limit']]) }}
                                @endif
                            </dd>
                        </div>
                        @if (!empty($session['speakers']))
                            <div class="govuk-summary-list__row">
                                <dt class="govuk-summary-list__key">{{ __('govuk_alpha.events.agenda.fields.speakers') }}</dt>
                                <dd class="govuk-summary-list__value">
                                    <ul class="govuk-list govuk-list--bullet">
                                        @foreach ($session['speakers'] as $speaker)
                                            <li>{{ $speaker['display_name'] }}@if(!empty($speaker['role'])), {{ $speaker['role'] }}@endif</li>
                                        @endforeach
                                    </ul>
                                </dd>
                            </div>
                        @endif
                    </dl>
                    @if (!empty($session['description']))
                        <p class="govuk-body">{{ $session['description'] }}</p>
                    @endif

                    @if (!empty($session['resources']))
                        <h4 class="govuk-heading-s">{{ __('event_agenda.resources_title') }}</h4>
                        <ul class="govuk-list govuk-list--bullet">
                            @foreach ($session['resources'] as $resource)
                                <li>
                                    <strong>{{ __('event_agenda.resource_types.' . $resource['type']) }}:</strong>
                                    @if (!empty($resource['url']))
                                        <a class="govuk-link" href="{{ $resource['url'] }}" target="_blank" rel="noopener noreferrer">{{ $resource['title'] }}</a>
                                        <span class="govuk-visually-hidden">{{ __('event_agenda.opens_new_window') }}</span>
                                    @else
                                        {{ $resource['title'] }} — {{ __('event_agenda.resource_unavailable') }}
                                    @endif
                                </li>
                            @endforeach
                        </ul>
                    @endif

                    @if (!empty($registration['can_register']))
                        <form method="post" action="{{ route('govuk-alpha.events.agenda.update', ['tenantSlug' => $tenantSlug, 'id' => $eventId]) }}" class="govuk-!-margin-bottom-4">
                            @csrf
                            <input type="hidden" name="action" value="register">
                            <input type="hidden" name="session_id" value="{{ $sessionId }}">
                            <input type="hidden" name="expected_version" value="{{ (int) ($registration['version'] ?? 0) }}">
                            <input type="hidden" name="idempotency_key" value="{{ \Illuminate\Support\Str::uuid() }}">
                            <button class="govuk-button" data-module="govuk-button">{{ __('event_agenda.register_action') }}</button>
                        </form>
                    @endif
                    @if (!empty($registration['can_withdraw']))
                        <form method="post" action="{{ route('govuk-alpha.events.agenda.update', ['tenantSlug' => $tenantSlug, 'id' => $eventId]) }}" class="govuk-!-margin-bottom-4">
                            @csrf
                            <input type="hidden" name="action" value="withdraw">
                            <input type="hidden" name="session_id" value="{{ $sessionId }}">
                            <input type="hidden" name="expected_version" value="{{ (int) ($registration['version'] ?? 0) }}">
                            <input type="hidden" name="idempotency_key" value="{{ \Illuminate\Support\Str::uuid() }}">
                            <div class="govuk-checkboxes govuk-!-margin-bottom-4">
                                <div class="govuk-checkboxes__item">
                                    <input class="govuk-checkboxes__input" id="{{ $sessionKey }}-confirm-withdraw" name="confirm_destructive" type="checkbox" value="1" required>
                                    <label class="govuk-label govuk-checkboxes__label" for="{{ $sessionKey }}-confirm-withdraw">{{ __('event_agenda.withdraw_confirmation', ['title' => $session['title']]) }}</label>
                                </div>
                            </div>
                            <button class="govuk-button govuk-button--secondary" data-module="govuk-button">{{ __('event_agenda.withdraw_action') }}</button>
                        </form>
                    @endif
                    @if (($registration['state'] ?? null) === 'registered')
                        <p class="govuk-body"><strong>{{ __('event_agenda.registered_state') }}</strong></p>
                    @elseif (($registration['state'] ?? null) === 'ineligible')
                        <p class="govuk-body">{{ __('event_agenda.ineligible_state') }}</p>
                    @elseif (empty($registration['can_register']) && empty($registration['can_withdraw']) && !empty($capacity['is_full']))
                        <p class="govuk-body">{{ __('event_agenda.full_state') }}</p>
                    @endif

                    @if ($canManage)
                        <div class="govuk-button-group">
                            @foreach ([['move_up', $index > 0, 'move_up'], ['move_down', $index < count($scheduledSessions) - 1, 'move_down']] as [$moveAction, $enabled, $labelKey])
                                @if ($enabled)
                                    <form method="post" action="{{ route('govuk-alpha.events.agenda.update', ['tenantSlug' => $tenantSlug, 'id' => $eventId]) }}">
                                        @csrf
                                        <input type="hidden" name="action" value="{{ $moveAction }}">
                                        <input type="hidden" name="session_id" value="{{ $sessionId }}">
                                        <input type="hidden" name="expected_agenda_version" value="{{ $agenda['agenda_version'] }}">
                                        <input type="hidden" name="idempotency_key" value="{{ \Illuminate\Support\Str::uuid() }}">
                                        <button class="govuk-button govuk-button--secondary govuk-!-margin-bottom-0" data-module="govuk-button">{{ __('govuk_alpha.events.agenda.' . $labelKey, ['title' => $session['title']]) }}</button>
                                    </form>
                                @endif
                            @endforeach
                        </div>

                        <details class="govuk-details" data-module="govuk-details" @if($useOld) open @endif>
                            <summary class="govuk-details__summary"><span class="govuk-details__summary-text">{{ __('govuk_alpha.events.agenda.edit_session', ['title' => $session['title']]) }}</span></summary>
                            <div class="govuk-details__text">
                                <form method="post" action="{{ route('govuk-alpha.events.agenda.update', ['tenantSlug' => $tenantSlug, 'id' => $eventId]) }}">
                                    @csrf
                                    <input type="hidden" name="action" value="update">
                                    <input type="hidden" name="session_id" value="{{ $sessionId }}">
                                    <input type="hidden" name="expected_version" value="{{ $session['version'] }}">
                                    <input type="hidden" name="idempotency_key" value="{{ \Illuminate\Support\Str::uuid() }}">
                                    @include('accessible-frontend::partials.event-agenda-fields', [
                                        'formKey' => $sessionKey,
                                        'values' => array_merge($session, [
                                            'start_at_local' => $localInput($session['start_at'] ?? null),
                                            'end_at_local' => $localInput($session['end_at'] ?? null),
                                        ]),
                                        'speakerRows' => $session['speakers'] ?? [],
                                        'resourceRows' => $session['resources'] ?? [],
                                        'useOld' => $useOld,
                                    ])
                                    <button class="govuk-button" data-module="govuk-button">{{ __('govuk_alpha.events.agenda.save_changes') }}</button>
                                </form>
                            </div>
                        </details>

                        <details class="govuk-details" data-module="govuk-details">
                            <summary class="govuk-details__summary"><span class="govuk-details__summary-text">{{ __('govuk_alpha.events.agenda.cancel_session', ['title' => $session['title']]) }}</span></summary>
                            <div class="govuk-details__text">
                                <form method="post" action="{{ route('govuk-alpha.events.agenda.update', ['tenantSlug' => $tenantSlug, 'id' => $eventId]) }}">
                                    @csrf
                                    <input type="hidden" name="action" value="cancel">
                                    <input type="hidden" name="session_id" value="{{ $sessionId }}">
                                    <input type="hidden" name="expected_version" value="{{ $session['version'] }}">
                                    <input type="hidden" name="idempotency_key" value="{{ \Illuminate\Support\Str::uuid() }}">
                                    <div class="govuk-form-group">
                                        <label class="govuk-label" for="{{ $sessionKey }}-cancel-reason">{{ __('govuk_alpha.events.agenda.cancellation_reason') }}</label>
                                        <textarea class="govuk-textarea" id="{{ $sessionKey }}-cancel-reason" name="reason" rows="3" maxlength="500" required></textarea>
                                    </div>
                                    <button class="govuk-button govuk-button--warning" data-module="govuk-button">{{ __('govuk_alpha.events.agenda.confirm_cancel') }}</button>
                                </form>
                            </div>
                        </details>
                    @endif
                </li>
            @endforeach
        </ol>
    @endif

    @if ($canManage && !empty($cancelledSessions))
        <h2 class="govuk-heading-l">{{ __('govuk_alpha.events.agenda.cancelled_sessions') }}</h2>
        <ul class="govuk-list govuk-list--bullet">
            @foreach ($cancelledSessions as $session)
                <li><strong>{{ $session['title'] }}</strong>@if(!empty($session['cancellation_reason'])) — {{ __('govuk_alpha.events.agenda.cancelled_reason', ['reason' => $session['cancellation_reason']]) }}@endif</li>
            @endforeach
        </ul>
    @endif
@endsection
