{{-- Copyright © 2024–2026 Jasper Ford --}}
{{-- SPDX-License-Identifier: AGPL-3.0-or-later --}}
{{-- Author: Jasper Ford --}}
{{-- See NOTICE file for attribution and acknowledgements. --}}
@extends('accessible-frontend::layout')

@section('content')
    <h1 class="govuk-heading-xl">{{ __('govuk_alpha_whats_on.index.title') }}</h1>
    <p class="govuk-body-l">{{ __('govuk_alpha_whats_on.index.intro') }}</p>

    @if (!$isAuthenticated)
        <div class="govuk-inset-text">
            <p class="govuk-body govuk-!-margin-bottom-2">{{ __('govuk_alpha_whats_on.index.register_prompt') }}</p>
            <a class="govuk-link" href="{{ route('govuk-alpha.login', ['tenantSlug' => $tenantSlug]) }}">
                {{ __('govuk_alpha_whats_on.index.sign_in_link') }}
            </a>
        </div>
    @endif

    <form method="get" action="{{ route('govuk-alpha.whats-on.index', ['tenantSlug' => $tenantSlug]) }}" data-alpha-auto-submit>
        <div class="govuk-form-group">
            <label class="govuk-label" for="whats-on-search">{{ __('govuk_alpha_whats_on.index.search_label') }}</label>
            <input class="govuk-input govuk-!-width-two-thirds" id="whats-on-search" name="q" type="search" value="{{ $search }}">
        </div>
        <div class="govuk-form-group">
            <label class="govuk-label" for="whats-on-when">{{ __('govuk_alpha_whats_on.index.when_label') }}</label>
            <select class="govuk-select" id="whats-on-when" name="when">
                @foreach (['upcoming', 'past', 'all'] as $option)
                    <option value="{{ $option }}" @selected($when === $option)>{{ __('govuk_alpha_whats_on.index.when_' . $option) }}</option>
                @endforeach
            </select>
        </div>
        <button type="submit" class="govuk-button govuk-button--secondary" data-module="govuk-button">
            {{ __('govuk_alpha_whats_on.index.apply') }}
        </button>
    </form>

    @if ($events === [])
        <p class="govuk-body">{{ __('govuk_alpha_whats_on.index.empty') }}</p>
    @else
        <ul class="govuk-list">
            @foreach ($events as $event)
                @php
                    $eventWhen = $event['start_time']
                        ? \Illuminate\Support\Carbon::parse($event['start_time'])
                            ->setTimezone($event['timezone'] ?: 'UTC')
                            ->translatedFormat($event['all_day'] ? 'j F Y' : 'j F Y, g:ia')
                        : null;
                @endphp
                <li class="govuk-!-margin-bottom-6">
                    <h2 class="govuk-heading-m govuk-!-margin-bottom-1">
                        <a class="govuk-link" href="{{ route('govuk-alpha.whats-on.show', ['tenantSlug' => $tenantSlug, 'id' => $event['id']]) }}">
                            {{ $event['title'] }}
                        </a>
                    </h2>
                    <p class="govuk-body govuk-!-margin-bottom-1">
                        @if ($eventWhen)
                            <span>{{ $eventWhen }}</span>
                        @endif
                        @if (!empty($event['is_online']))
                            <strong class="govuk-tag govuk-tag--blue govuk-!-margin-left-2">{{ __('govuk_alpha_whats_on.index.online_tag') }}</strong>
                        @elseif (!empty($event['location']))
                            <span class="govuk-!-margin-left-2">{{ $event['location'] }}</span>
                        @endif
                    </p>
                    @if (!empty($event['category']['name']))
                        <p class="govuk-body-s govuk-!-margin-bottom-0">{{ $event['category']['name'] }}</p>
                    @endif
                </li>
            @endforeach
        </ul>

        @if ($nextCursor)
            <a class="govuk-button govuk-button--secondary" data-module="govuk-button"
               href="{{ route('govuk-alpha.whats-on.index', array_filter(['tenantSlug' => $tenantSlug, 'when' => $when, 'q' => $search !== '' ? $search : null, 'cursor' => $nextCursor])) }}">
                {{ __('govuk_alpha_whats_on.index.more') }}
            </a>
        @endif
    @endif
@endsection
