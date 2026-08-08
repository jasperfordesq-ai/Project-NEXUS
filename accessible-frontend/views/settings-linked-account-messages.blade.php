{{-- Copyright © 2024–2026 Jasper Ford --}}
{{-- SPDX-License-Identifier: AGPL-3.0-or-later --}}
{{-- Author: Jasper Ford --}}
{{-- See NOTICE file for attribution and acknowledgements. --}}
@extends('accessible-frontend::layout')

{{--
    Read-only conversation list for a supported member (React
    SupportedMessagesPage parity). Strictly read-only by construction: this
    page contains no form that can send anything, nothing is marked as read,
    and every visit was already written to the immutable view audit — with the
    supporter's stated purpose — before this page rendered.
--}}

@section('content')
    @php
        $conversations = $conversations ?? [];
        $formatDate = fn ($value): ?string => $value ? \Illuminate\Support\Carbon::parse($value)->translatedFormat('j F Y, g:ia') : null;
    @endphp

    <div class="govuk-grid-row">
        <div class="govuk-grid-column-two-thirds">
            <a class="govuk-back-link" href="{{ route('govuk-alpha.settings.linked-accounts', ['tenantSlug' => $tenantSlug]) }}">{{ __('govuk_alpha_settings.linked.activity_back') }}</a>

            <span class="govuk-caption-xl">{{ __('govuk_alpha_settings.linked.title') }}</span>
            <h1 class="govuk-heading-xl">{{ __('govuk_alpha_settings.linked_messages.title', ['name' => $childName]) }}</h1>

            <div class="govuk-inset-text">
                <p class="govuk-body govuk-!-margin-bottom-0">{{ __('govuk_alpha_settings.linked_messages.read_only_banner') }}</p>
            </div>

            @if (empty($conversations))
                <p class="govuk-body">{{ __('govuk_alpha_settings.linked_messages.empty_list') }}</p>
            @else
                <ul class="govuk-list nexus-alpha-card-list">
                    @foreach ($conversations as $conversation)
                        @php
                            $partner = is_array($conversation['other_user'] ?? null) ? $conversation['other_user'] : [];
                            $partnerUserId = (int) ($conversation['partner_id'] ?? ($partner['id'] ?? 0));
                            $partnerName = trim((string) ($partner['name'] ?? trim(($partner['first_name'] ?? '') . ' ' . ($partner['last_name'] ?? ''))));
                            $partnerName = $partnerName !== '' ? $partnerName : __('govuk_alpha_settings.common.unknown_member');
                            $preview = is_array($conversation['last_message'] ?? null) ? (string) ($conversation['last_message']['body'] ?? '') : '';
                            $previewAt = $formatDate($conversation['last_message']['created_at'] ?? ($conversation['created_at'] ?? null));
                        @endphp
                        @if ($partnerUserId > 0)
                            <li class="nexus-alpha-card">
                                <p class="govuk-body govuk-!-font-weight-bold govuk-!-margin-bottom-1">
                                    <a class="govuk-link" href="{{ route('govuk-alpha.settings.linked-accounts.messages.thread', ['tenantSlug' => $tenantSlug, 'childId' => $childUserId, 'partnerId' => $partnerUserId]) }}">
                                        {{ __('govuk_alpha_settings.linked_messages.open_thread', ['name' => $partnerName]) }}
                                    </a>
                                </p>
                                @if ($preview !== '')
                                    <p class="govuk-body-s govuk-!-margin-bottom-1">{{ \Illuminate\Support\Str::limit($preview, 140) }}</p>
                                @endif
                                @if ($previewAt)
                                    <p class="govuk-body-s nexus-alpha-meta govuk-!-margin-bottom-0">{{ $previewAt }}</p>
                                @endif
                            </li>
                        @endif
                    @endforeach
                </ul>
                @if (($hasMore ?? false) && !empty($nextCursor))
                    <nav class="govuk-pagination" aria-label="{{ __('govuk_alpha.fed2.connections.pagination_next') }}">
                        <div class="govuk-pagination__next">
                            <a class="govuk-link govuk-pagination__link" rel="next" href="{{ route('govuk-alpha.settings.linked-accounts.messages', ['tenantSlug' => $tenantSlug, 'childId' => $childUserId, 'cursor' => $nextCursor]) }}">
                                <span class="govuk-pagination__link-title">{{ __('govuk_alpha.fed2.connections.pagination_next') }}</span>
                            </a>
                        </div>
                    </nav>
                @endif
            @endif
        </div>
    </div>
@endsection
