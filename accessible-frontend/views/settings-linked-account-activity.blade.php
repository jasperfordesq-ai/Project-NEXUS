{{-- Copyright © 2024–2026 Jasper Ford --}}
{{-- SPDX-License-Identifier: AGPL-3.0-or-later --}}
{{-- Author: Jasper Ford --}}
{{-- See NOTICE file for attribution and acknowledgements. --}}
@extends('accessible-frontend::layout')

{{--
    Read-only activity summary for a supported member (React
    SupportActivityModal parity). Deliberately offers NO actions: seeing is the
    `assist` tier; preparing and acting live elsewhere and carry their own
    tier rules. Plain HTML — no JavaScript required to read any of it.
--}}

@section('content')
    @php
        $summary = $summary ?? [];
        $hours = is_array($summary['hours_summary'] ?? null) ? $summary['hours_summary'] : null;
        $connections = is_array($summary['connection_stats'] ?? null) ? $summary['connection_stats'] : null;
        $engagement = is_array($summary['engagement'] ?? null) ? $summary['engagement'] : null;
        $timeline = array_slice(is_array($summary['timeline'] ?? null) ? $summary['timeline'] : [], 0, 10);
        $knownTypes = ['post', 'comment', 'connection', 'gave_hours', 'received_hours'];
    @endphp

    <div class="govuk-grid-row">
        <div class="govuk-grid-column-two-thirds">
            <a class="govuk-back-link" href="{{ route('govuk-alpha.settings.linked-accounts', ['tenantSlug' => $tenantSlug]) }}">{{ __('govuk_alpha_settings.linked.activity_back') }}</a>

            <span class="govuk-caption-xl">{{ __('govuk_alpha_settings.linked.title') }}</span>
            <h1 class="govuk-heading-xl">{{ __('govuk_alpha_settings.linked.activity_title', ['name' => $childName]) }}</h1>
            <p class="govuk-body-l">{{ __('govuk_alpha_settings.linked.activity_intro', ['name' => $childName]) }}</p>

            @if ($hours)
                <h2 class="govuk-heading-l">{{ __('govuk_alpha_settings.linked.activity_hours_heading') }}</h2>
                <dl class="govuk-summary-list">
                    <div class="govuk-summary-list__row">
                        <dt class="govuk-summary-list__key">{{ __('govuk_alpha_settings.linked.activity_hours_given') }}</dt>
                        <dd class="govuk-summary-list__value">{{ $hours['hours_given'] ?? 0 }}</dd>
                    </div>
                    <div class="govuk-summary-list__row">
                        <dt class="govuk-summary-list__key">{{ __('govuk_alpha_settings.linked.activity_hours_received') }}</dt>
                        <dd class="govuk-summary-list__value">{{ $hours['hours_received'] ?? 0 }}</dd>
                    </div>
                    <div class="govuk-summary-list__row">
                        <dt class="govuk-summary-list__key">{{ __('govuk_alpha_settings.linked.activity_net_balance') }}</dt>
                        <dd class="govuk-summary-list__value">{{ $hours['net_balance'] ?? 0 }}</dd>
                    </div>
                </dl>
            @endif

            @if ($connections || $engagement)
                <h2 class="govuk-heading-l">{{ __('govuk_alpha_settings.linked.activity_community_heading') }}</h2>
                <dl class="govuk-summary-list">
                    @if ($connections)
                        <div class="govuk-summary-list__row">
                            <dt class="govuk-summary-list__key">{{ __('govuk_alpha_settings.linked.activity_connections') }}</dt>
                            <dd class="govuk-summary-list__value">{{ $connections['total_connections'] ?? 0 }}</dd>
                        </div>
                        <div class="govuk-summary-list__row">
                            <dt class="govuk-summary-list__key">{{ __('govuk_alpha_settings.linked.activity_groups') }}</dt>
                            <dd class="govuk-summary-list__value">{{ $connections['groups_joined'] ?? 0 }}</dd>
                        </div>
                    @endif
                    @if ($engagement)
                        <div class="govuk-summary-list__row">
                            <dt class="govuk-summary-list__key">{{ __('govuk_alpha_settings.linked.activity_posts') }}</dt>
                            <dd class="govuk-summary-list__value">{{ $engagement['posts_count'] ?? 0 }}</dd>
                        </div>
                    @endif
                </dl>
            @endif

            <h2 class="govuk-heading-l">{{ __('govuk_alpha_settings.linked.activity_timeline_heading') }}</h2>
            @if (empty($timeline))
                <div class="govuk-inset-text"><p class="govuk-body">{{ __('govuk_alpha_settings.linked.activity_timeline_empty') }}</p></div>
            @else
                <ul class="govuk-list nexus-alpha-card-list">
                    @foreach ($timeline as $item)
                        @php
                            $itemType = (string) ($item['activity_type'] ?? '');
                            $typeKey = in_array($itemType, $knownTypes, true) ? $itemType : 'other';
                            $itemDate = (string) ($item['created_at'] ?? '');
                        @endphp
                        <li class="nexus-alpha-card">
                            <p class="govuk-body-s nexus-alpha-meta govuk-!-margin-bottom-1">
                                {{ __('govuk_alpha_settings.linked.activity_type_' . $typeKey) }}
                                @if ($itemDate !== '')
                                    — <time datetime="{{ $itemDate }}">{{ \Illuminate\Support\Carbon::parse($itemDate)->locale(app()->getLocale())->translatedFormat('j M Y, G:i') }}</time>
                                @endif
                            </p>
                            @if (trim((string) ($item['description'] ?? '')) !== '')
                                <p class="govuk-body govuk-!-margin-bottom-0">{{ $item['description'] }}</p>
                            @endif
                        </li>
                    @endforeach
                </ul>
            @endif
        </div>
    </div>
@endsection
