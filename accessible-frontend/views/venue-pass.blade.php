{{-- Copyright © 2024–2026 Jasper Ford --}}
{{-- SPDX-License-Identifier: AGPL-3.0-or-later --}}
{{-- Author: Jasper Ford --}}
{{-- See NOTICE file for attribution and acknowledgements. --}}
@extends('accessible-frontend::layout')

@section('content')
    <a class="govuk-back-link" href="{{ route('govuk-alpha.venues.index', ['tenantSlug' => $tenantSlug]) }}">
        {{ __('govuk_alpha_venues.pass.back') }}
    </a>

    <h1 class="govuk-heading-xl">{{ __('govuk_alpha_venues.pass.title') }}</h1>
    <p class="govuk-body-l">{{ __('govuk_alpha_venues.pass.intro') }}</p>

    {{-- Server-rendered SVG: the QR works with no JavaScript and no external
         request. The alt/label describes purpose, not the token. --}}
    <figure class="govuk-!-margin-bottom-6" role="img" aria-label="{{ __('govuk_alpha_venues.pass.qr_alt') }}">
        {!! $qrSvg !!}
    </figure>

    <div class="govuk-inset-text">
        <p class="govuk-body govuk-!-margin-bottom-0">{{ __('govuk_alpha_venues.pass.privacy') }}</p>
    </div>

    <h2 class="govuk-heading-m">{{ __('govuk_alpha_venues.pass.visits_title') }}</h2>
    @if ($visits === [])
        <p class="govuk-body">{{ __('govuk_alpha_venues.pass.visits_empty') }}</p>
    @else
        <dl class="govuk-summary-list">
            @foreach ($visits as $visit)
                <div class="govuk-summary-list__row">
                    <dt class="govuk-summary-list__key">{{ $visit['venue_name'] }}</dt>
                    <dd class="govuk-summary-list__value">
                        {{ \Illuminate\Support\Carbon::parse($visit['visited_on'])->translatedFormat('j F Y') }}
                    </dd>
                </div>
            @endforeach
        </dl>
    @endif
@endsection
