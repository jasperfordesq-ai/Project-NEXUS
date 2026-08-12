{{-- Copyright © 2024–2026 Jasper Ford --}}
{{-- SPDX-License-Identifier: AGPL-3.0-or-later --}}
{{-- Author: Jasper Ford --}}
{{-- See NOTICE file for attribution and acknowledgements. --}}
@extends('accessible-frontend::layout')

@section('content')
    @php
        $communityName = $tenant['name'] ?? $tenantSlug;
        $stats = $stats ?? null;
        $contributors = $contributors ?? [];
        $byType = ['creator' => [], 'founder' => [], 'contributor' => [], 'acknowledgement' => []];
        foreach ($contributors as $person) {
            $type = $person['type'] ?? 'contributor';
            if (isset($byType[$type])) {
                $byType[$type][] = $person;
            }
        }
        $hasResearchNote = false;
        foreach ($byType['contributor'] as $person) {
            if (! empty($person['note']) && stripos((string) $person['note'], 'study') !== false) {
                $hasResearchNote = true;
            }
        }
        $steps = __('govuk_alpha.about.how_it_works.steps');
        $values = __('govuk_alpha.about.values.items');
    @endphp

    <div class="govuk-grid-row">
        <div class="govuk-grid-column-two-thirds">
            <span class="govuk-caption-l">{{ __('govuk_alpha.about.caption', ['community' => $communityName]) }}</span>
            <h1 class="govuk-heading-xl">{{ __('govuk_alpha.about.title', ['name' => $communityName]) }}</h1>
            <p class="govuk-body-l">{{ __('govuk_alpha.about.description', ['name' => $communityName]) }}</p>
        </div>
    </div>

    <div class="govuk-grid-row">
        <div class="govuk-grid-column-two-thirds">
            <h2 class="govuk-heading-l">{{ __('govuk_alpha.about.how_it_works.title') }}</h2>
            <p class="govuk-body">{{ __('govuk_alpha.about.how_it_works.subtitle') }}</p>
            <ol class="govuk-list govuk-list--number">
                @if (is_array($steps))
                    @foreach ($steps as $step)
                        <li>
                            <span class="govuk-!-font-weight-bold">{{ $step['title'] }}.</span>
                            {{ $step['description'] }}
                        </li>
                    @endforeach
                @endif
            </ol>

            <h2 class="govuk-heading-l">{{ __('govuk_alpha.about.values.title') }}</h2>
            <p class="govuk-body">{{ __('govuk_alpha.about.values.subtitle', ['name' => $communityName]) }}</p>
            @if (is_array($values))
                @foreach ($values as $value)
                    <h3 class="govuk-heading-s govuk-!-margin-bottom-1">{{ $value['title'] }}</h3>
                    <p class="govuk-body">{{ $value['description'] }}</p>
                @endforeach
            @endif
        </div>
    </div>

    @if (is_array($stats) && ! empty($stats))
        <h2 class="govuk-heading-l">{{ __('govuk_alpha.about.stats.title') }}</h2>
        <dl class="nexus-alpha-stat-grid govuk-!-margin-bottom-8">
            <div class="nexus-alpha-stat">
                <dt>{{ __('govuk_alpha.about.stats.members') }}</dt>
                <dd>{{ number_format((int) ($stats['members'] ?? 0)) }}</dd>
            </div>
            <div class="nexus-alpha-stat">
                <dt>{{ __('govuk_alpha.about.stats.hours_exchanged') }}</dt>
                <dd>{{ number_format((float) ($stats['hours_exchanged'] ?? 0)) }}</dd>
            </div>
            <div class="nexus-alpha-stat">
                <dt>{{ __('govuk_alpha.about.stats.active_listings') }}</dt>
                <dd>{{ number_format((int) ($stats['listings'] ?? 0)) }}</dd>
            </div>
            <div class="nexus-alpha-stat">
                <dt>{{ __('govuk_alpha.about.stats.communities') }}</dt>
                <dd>{{ number_format((int) ($stats['communities'] ?? 0)) }}</dd>
            </div>
        </dl>
    @endif

    <div class="govuk-grid-row">
        <div class="govuk-grid-column-two-thirds">
            <h2 class="govuk-heading-l">{{ __('govuk_alpha.about.credits.title') }}</h2>
            <p class="govuk-body">{{ __('govuk_alpha.about.credits.subtitle') }}</p>

            @if (! empty($byType['creator']))
                <h3 class="govuk-heading-s govuk-!-margin-bottom-1">{{ __('govuk_alpha.about.credits.creator') }}</h3>
                <ul class="govuk-list">
                    @foreach ($byType['creator'] as $person)
                        <li>{{ $person['name'] }}@if (! empty($person['role'])) — {{ $person['role'] }}@endif</li>
                    @endforeach
                </ul>
            @endif

            @if (! empty($byType['founder']))
                <h3 class="govuk-heading-s govuk-!-margin-bottom-1">{{ __('govuk_alpha.about.credits.founders_heading') }}</h3>
                <ul class="govuk-list">
                    @foreach ($byType['founder'] as $person)
                        <li>{{ $person['name'] }}@if (! empty($person['role'])) — {{ $person['role'] }}@endif</li>
                    @endforeach
                </ul>
            @endif

            @if (! empty($byType['contributor']))
                <h3 class="govuk-heading-s govuk-!-margin-bottom-1">{{ __('govuk_alpha.about.credits.contributors') }}</h3>
                <ul class="govuk-list">
                    @foreach ($byType['contributor'] as $person)
                        <li>{{ $person['name'] }}@if (! empty($person['role'])) — {{ $person['role'] }}@endif</li>
                    @endforeach
                </ul>
                @if ($hasResearchNote)
                    <h3 class="govuk-heading-s govuk-!-margin-bottom-1">{{ __('govuk_alpha.about.credits.research_heading') }}</h3>
                    <p class="govuk-body">{{ __('govuk_alpha.about.credits.research_description') }}</p>
                @endif
            @endif

            @if (! empty($byType['acknowledgement']))
                <h3 class="govuk-heading-s govuk-!-margin-bottom-1">{{ __('govuk_alpha.about.credits.acknowledgements') }}</h3>
                <ul class="govuk-list">
                    @foreach ($byType['acknowledgement'] as $person)
                        <li>{{ $person['name'] }}@if (! empty($person['role'])) — {{ $person['role'] }}@endif</li>
                    @endforeach
                </ul>
            @endif

            <h3 class="govuk-heading-s govuk-!-margin-bottom-1">{{ __('govuk_alpha.about.credits.open_source') }}</h3>
            <p class="govuk-body">{{ __('govuk_alpha.about.credits.license_text') }}</p>
            <ul class="govuk-list">
                <li>
                    <a class="govuk-link" href="https://github.com/jasperfordesq-ai/Project-NEXUS" rel="noopener noreferrer">{{ __('govuk_alpha.about.credits.v1_source') }}</a>
                </li>
                <li>
                    <a class="govuk-link" href="https://github.com/jasperfordesq-ai/api.project-nexus.net" rel="noopener noreferrer">{{ __('govuk_alpha.about.credits.v2_source') }}</a>
                </li>
            </ul>

            <h2 class="govuk-heading-l">{{ __('govuk_alpha.about.cta.title') }}</h2>
            <p class="govuk-body">{{ __('govuk_alpha.about.cta.description') }}</p>
            <div class="govuk-button-group">
                @if ($isAuthenticated ?? false)
                    <a class="govuk-button" data-module="govuk-button" href="{{ route('govuk-alpha.dashboard', ['tenantSlug' => $tenantSlug]) }}">{{ __('govuk_alpha.about.cta.dashboard') }}</a>
                @else
                    <a class="govuk-button" data-module="govuk-button" href="{{ route('govuk-alpha.register', ['tenantSlug' => $tenantSlug]) }}">{{ __('govuk_alpha.about.cta.join') }}</a>
                @endif
                <a class="govuk-link" href="{{ route('govuk-alpha.contact', ['tenantSlug' => $tenantSlug]) }}">{{ __('govuk_alpha.about.cta.contact_us') }}</a>
            </div>
        </div>
    </div>
@endsection
