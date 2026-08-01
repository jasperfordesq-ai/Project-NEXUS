{{-- Copyright © 2024–2026 Jasper Ford --}}
{{-- SPDX-License-Identifier: AGPL-3.0-or-later --}}
{{-- Author: Jasper Ford --}}
{{-- See NOTICE file for attribution and acknowledgements. --}}
@extends('accessible-frontend::layout')

@section('content')
    <h1 class="govuk-heading-xl">{{ __('govuk_alpha_venues.index.title') }}</h1>
    <p class="govuk-body-l">{{ __('govuk_alpha_venues.index.intro') }}</p>

    <a class="govuk-button" data-module="govuk-button" href="{{ route('govuk-alpha.venues.pass', ['tenantSlug' => $tenantSlug]) }}">
        {{ __('govuk_alpha_venues.index.my_pass') }}
    </a>

    @if ($venues === [])
        <p class="govuk-body">{{ __('govuk_alpha_venues.index.empty') }}</p>
    @else
        <ul class="govuk-list">
            @foreach ($venues as $venue)
                <li class="govuk-!-margin-bottom-6">
                    <h2 class="govuk-heading-m govuk-!-margin-bottom-1">{{ $venue['name'] }}</h2>
                    @if (!empty($venue['offer_summary']))
                        <p class="govuk-body govuk-!-margin-bottom-1">{{ $venue['offer_summary'] }}</p>
                    @endif
                    @php
                        $addressParts = array_filter([
                            $venue['address_line'] ?? null,
                            $venue['city'] ?? null,
                            $venue['postcode'] ?? null,
                        ]);
                    @endphp
                    @if ($addressParts !== [])
                        <p class="govuk-body-s govuk-!-margin-bottom-1">{{ implode(', ', $addressParts) }}</p>
                    @endif
                    @if (!empty($venue['website']))
                        <p class="govuk-body-s govuk-!-margin-bottom-0">
                            <a class="govuk-link" href="{{ $venue['website'] }}" rel="noopener noreferrer">
                                {{ __('govuk_alpha_venues.index.website') }}
                            </a>
                        </p>
                    @endif
                </li>
            @endforeach
        </ul>
    @endif

    <div class="govuk-inset-text">
        {{ __('govuk_alpha_venues.index.how_it_works') }}
    </div>
@endsection
