{{-- Copyright © 2024–2026 Jasper Ford --}}
{{-- SPDX-License-Identifier: AGPL-3.0-or-later --}}
{{-- Author: Jasper Ford --}}
{{-- See NOTICE file for attribution and acknowledgements. --}}
@extends('accessible-frontend::layout')

@section('content')
    <h1 class="govuk-heading-xl">{{ __('govuk_alpha_venues.checkin.title') }}</h1>

    @php
        $status = is_array($result ?? null) ? ($result['status'] ?? null) : null;
    @endphp

    @if ($status === 'recorded' || $status === 'already_recorded_today')
        <div class="govuk-notification-banner govuk-notification-banner--success" data-module="govuk-notification-banner" role="alert" aria-labelledby="venue-checkin-result-title">
            <div class="govuk-notification-banner__header">
                <h2 class="govuk-notification-banner__title" id="venue-checkin-result-title">{{ __('govuk_alpha.states.success_title') }}</h2>
            </div>
            <div class="govuk-notification-banner__content">
                <p class="govuk-notification-banner__heading">
                    {{ $status === 'recorded'
                        ? __('govuk_alpha_venues.checkin.recorded', ['member' => $result['member']['name'] ?? '', 'venue' => $result['venue']['name'] ?? ''])
                        : __('govuk_alpha_venues.checkin.already_recorded', ['member' => $result['member']['name'] ?? '']) }}
                </p>
                @if (!empty($result['visits_this_month']))
                    <p class="govuk-body">{{ __('govuk_alpha_venues.checkin.visits_this_month', ['count' => $result['visits_this_month']]) }}</p>
                @endif
                @foreach (($result['completed_challenges'] ?? []) as $challenge)
                    <p class="govuk-body">{{ __('govuk_alpha_venues.checkin.challenge_completed', ['title' => $challenge['title']]) }}</p>
                @endforeach
            </div>
        </div>
        <a class="govuk-link" href="{{ route('govuk-alpha.venues.index', ['tenantSlug' => $tenantSlug]) }}">{{ __('govuk_alpha_venues.checkin.done') }}</a>
    @elseif ($status === 'forbidden' || $status === 'invalid_pass')
        {{-- Page-level outcome, not field validation: the GOV.UK error summary
             contract expects a list of links back to invalid fields, which
             does not exist here. The notification banner is the pattern for
             "something on this page needs your attention". --}}
        @php
            $checkinNoticeKey = $status === 'forbidden' ? 'forbidden' : 'invalid';
        @endphp
        <div class="govuk-notification-banner" role="alert" aria-labelledby="venue-checkin-notice-title" data-module="govuk-notification-banner">
            <div class="govuk-notification-banner__header">
                <h2 class="govuk-notification-banner__title" id="venue-checkin-notice-title">{{ __('govuk_alpha_venues.checkin.' . $checkinNoticeKey . '_title') }}</h2>
            </div>
            <div class="govuk-notification-banner__content">
                <p class="govuk-body">{{ __('govuk_alpha_venues.checkin.' . $checkinNoticeKey . '_body') }}</p>
            </div>
        </div>
    @else
        {{-- Initial GET (or needs_venue): nothing has been recorded. The visit
             only happens on the deliberate POST below — link-preview crawlers
             that prefetch this URL record nothing. --}}
        <p class="govuk-body-l">{{ __('govuk_alpha_venues.checkin.intro') }}</p>

        <form method="post" action="{{ route('govuk-alpha.venues.checkin.store', ['tenantSlug' => $tenantSlug, 'token' => $token]) }}">
            @csrf

            @if ($status === 'needs_venue')
                <div class="govuk-form-group">
                    <fieldset class="govuk-fieldset">
                        <legend class="govuk-fieldset__legend govuk-fieldset__legend--m">
                            {{ __('govuk_alpha_venues.checkin.choose_venue') }}
                        </legend>
                        <div class="govuk-radios" data-module="govuk-radios">
                            @foreach ($venueChoices as $index => $choice)
                                <div class="govuk-radios__item">
                                    <input class="govuk-radios__input" id="venue-choice-{{ $choice['id'] }}" name="venue_id" type="radio" value="{{ $choice['id'] }}" @checked($index === 0)>
                                    <label class="govuk-label govuk-radios__label" for="venue-choice-{{ $choice['id'] }}">{{ $choice['name'] }}</label>
                                </div>
                            @endforeach
                        </div>
                    </fieldset>
                </div>
            @endif

            <button type="submit" class="govuk-button" data-module="govuk-button">
                {{ __('govuk_alpha_venues.checkin.confirm') }}
            </button>
        </form>
    @endif
@endsection
