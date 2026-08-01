{{-- Copyright © 2024–2026 Jasper Ford --}}
{{-- SPDX-License-Identifier: AGPL-3.0-or-later --}}
{{-- Author: Jasper Ford --}}
{{-- See NOTICE file for attribution and acknowledgements. --}}
@extends('accessible-frontend::layout')

@section('content')
    <a class="govuk-back-link" href="{{ route('govuk-alpha.whats-on.index', ['tenantSlug' => $tenantSlug]) }}">
        {{ __('govuk_alpha_whats_on.show.back') }}
    </a>

    @php
        $timezone = $event['timezone'] ?: 'UTC';
        $format = $event['all_day'] ? 'j F Y' : 'j F Y, g:ia';
        $startsAt = $event['start_time']
            ? \Illuminate\Support\Carbon::parse($event['start_time'])->setTimezone($timezone)->translatedFormat($format)
            : null;
        $endsAt = $event['end_time']
            ? \Illuminate\Support\Carbon::parse($event['end_time'])->setTimezone($timezone)->translatedFormat($format)
            : null;
        $accessibility = is_array($event['accessibility'] ?? null) ? $event['accessibility'] : [];
        $accessibilityRows = array_filter([
            'step_free' => $accessibility['step_free'] ?? null,
            'accessible_toilet' => $accessibility['accessible_toilet'] ?? null,
            'hearing_loop' => $accessibility['hearing_loop'] ?? null,
            'quiet_space' => $accessibility['quiet_space'] ?? null,
            'seating' => $accessibility['seating'] ?? null,
            'parking' => $accessibility['parking'] ?? null,
        ], static fn ($value): bool => $value !== null);
    @endphp

    @if (!empty($event['category']['name']))
        <span class="govuk-caption-l">{{ $event['category']['name'] }}</span>
    @endif
    <h1 class="govuk-heading-xl">{{ $event['title'] }}</h1>

    <dl class="govuk-summary-list">
        @if ($startsAt)
            <div class="govuk-summary-list__row">
                <dt class="govuk-summary-list__key">{{ __('govuk_alpha_whats_on.show.starts') }}</dt>
                <dd class="govuk-summary-list__value">{{ $startsAt }}</dd>
            </div>
        @endif
        @if ($endsAt)
            <div class="govuk-summary-list__row">
                <dt class="govuk-summary-list__key">{{ __('govuk_alpha_whats_on.show.ends') }}</dt>
                <dd class="govuk-summary-list__value">{{ $endsAt }}</dd>
            </div>
        @endif
        <div class="govuk-summary-list__row">
            <dt class="govuk-summary-list__key">{{ __('govuk_alpha_whats_on.show.where') }}</dt>
            <dd class="govuk-summary-list__value">
                @if (!empty($event['is_online']))
                    {{ __('govuk_alpha_whats_on.show.online') }}
                @else
                    {{ $event['location'] ?? __('govuk_alpha_whats_on.show.location_tba') }}
                @endif
            </dd>
        </div>
        @if (!empty($event['organizer_name']))
            <div class="govuk-summary-list__row">
                <dt class="govuk-summary-list__key">{{ __('govuk_alpha_whats_on.show.organiser') }}</dt>
                <dd class="govuk-summary-list__value">{{ $event['organizer_name'] }}</dd>
            </div>
        @endif
    </dl>

    @if (!empty($event['description']))
        <p class="govuk-body">{{ $event['description'] }}</p>
    @endif

    @if ($accessibilityRows !== [] || !empty($accessibility['notes']))
        <h2 class="govuk-heading-m">{{ __('govuk_alpha_whats_on.show.accessibility_title') }}</h2>
        <ul class="govuk-list govuk-list--bullet">
            @foreach ($accessibilityRows as $key => $value)
                <li>
                    {{ __('govuk_alpha_whats_on.show.accessibility_' . $key) }}:
                    {{ $value ? __('govuk_alpha_whats_on.show.yes') : __('govuk_alpha_whats_on.show.no') }}
                </li>
            @endforeach
            @if (!empty($accessibility['notes']))
                <li>{{ $accessibility['notes'] }}</li>
            @endif
        </ul>
    @endif

    <div class="govuk-inset-text">
        <p class="govuk-body govuk-!-margin-bottom-2">{{ __('govuk_alpha_whats_on.show.register_prompt') }}</p>
        <a class="govuk-button" data-module="govuk-button" href="{{ route('govuk-alpha.login', ['tenantSlug' => $tenantSlug]) }}">
            {{ __('govuk_alpha_whats_on.show.sign_in_to_register') }}
        </a>
    </div>
@endsection
